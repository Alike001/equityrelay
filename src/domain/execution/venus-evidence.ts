import { decodeEventLog, decodeFunctionData, erc20Abi, parseAbi, type Hex } from "viem";
import { BSC_CHAIN_ID, isAddress, NVDAB_ADDRESS, sameAddress, VENUS_VNVDAB_ADDRESS } from "@/domain/routing/identity";
import type { Address } from "@/types/route";

// The event signatures follow the current Venus Core VToken interface. The
// deployed implementation writes the receiver's post-mint account balance into
// the final field, despite the current interface naming that field totalSupply.
export const venusSupplyAbi = parseAbi([
  "event Mint(address minter, uint256 mintAmount, uint256 mintTokens, uint256 totalSupply)",
  "event MintBehalf(address payer, address receiver, uint256 mintAmount, uint256 mintTokens, uint256 totalSupply)",
  "function mint(uint256 mintAmount) returns (uint256)",
  "function mintBehalf(address receiver, uint256 mintAmount) returns (uint256, uint256)",
]);

export const venusMarketReadAbi = parseAbi([
  "function underlying() view returns (address)",
  "function symbol() view returns (string)",
  "function implementation() view returns (address)",
  "function balanceOf(address account) view returns (uint256)",
  "function getAccountSnapshot(address account) view returns (uint256, uint256, uint256, uint256)",
]);

export type VenusReceiptLog = { address: Address; data: Hex; topics: readonly Hex[]; logIndex?: number | null };
export type VenusSupplyReason =
  | "VENUS_WRONG_CHAIN"
  | "VENUS_RECEIPT_FAILED"
  | "VENUS_MARKET_MISMATCH"
  | "VENUS_UNDERLYING_MISMATCH"
  | "VENUS_MARKET_IDENTITY_INVALID"
  | "VENUS_TRANSACTION_SEMANTICS_MISMATCH"
  | "VENUS_MINT_CALL_NOT_IDENTIFIED"
  | "VENUS_MINT_AMOUNT_MISMATCH"
  | "VENUS_SUPPLIER_MISMATCH"
  | "VENUS_RECEIVER_MISMATCH"
  | "VENUS_SUPPLY_EVENT_MISSING_OR_AMBIGUOUS"
  | "VENUS_UNDERLYING_TRANSFER_MISSING_OR_AMBIGUOUS"
  | "VENUS_VTOKEN_TRANSFER_MISSING_OR_AMBIGUOUS"
  | "VENUS_POSITION_EVIDENCE_MISMATCH";

export type VenusSupplyEvidence = {
  transactionHash: Hex;
  blockNumber: string;
  market: Address;
  underlying: Address;
  supplier: Address;
  receiver: Address;
  underlyingAmountRaw: string;
  vTokensMintedRaw: string;
  eventType: "Mint" | "MintBehalf";
  eventAccountBalanceRaw: string;
  resultingVTokenBalanceRaw: string;
};

export type VenusSupplyInspection =
  | { status: "VERIFIED"; evidence: VenusSupplyEvidence }
  | { status: "REJECTED"; reason: VenusSupplyReason };

export function decodeVenusSupplyCall(data: Hex):
  | { eventType: "Mint"; receiver: null; amountRaw: string }
  | { eventType: "MintBehalf"; receiver: Address; amountRaw: string } {
  try {
    const decoded = decodeFunctionData({ abi: venusSupplyAbi, data });
    if (decoded.functionName === "mint") return { eventType: "Mint", receiver: null, amountRaw: decoded.args[0].toString() };
    if (decoded.functionName === "mintBehalf") return { eventType: "MintBehalf", receiver: decoded.args[0] as Address, amountRaw: decoded.args[1].toString() };
  } catch { /* Deterministic refusal below. */ }
  throw new Error("VENUS_MINT_CALL_NOT_IDENTIFIED");
}

export function inspectVenusSupply(input: {
  chainId: number;
  transactionHash: Hex;
  transactionFrom: Address;
  transactionTo: Address;
  transactionValueRaw: string;
  calldata: Hex;
  receiptStatus: "success" | "reverted";
  receiptTo: Address;
  blockNumber: string;
  expectedWallet: Address;
  expectedAmountRaw: string;
  marketIdentity: { market: Address; underlying: Address; symbol: string; implementation: Address };
  logs: VenusReceiptLog[];
  position: {
    beforeBlock: string;
    afterBlock: string;
    receiverVTokenBalanceBeforeRaw: string;
    receiverVTokenBalanceAfterRaw: string;
    accountSnapshotAfter: readonly [string, string, string, string];
    marketUnderlyingBalanceBeforeRaw: string;
    marketUnderlyingBalanceAfterRaw: string;
  };
}): VenusSupplyInspection {
  const reject = (reason: VenusSupplyReason): VenusSupplyInspection => ({ status: "REJECTED", reason });
  if (input.chainId !== BSC_CHAIN_ID) return reject("VENUS_WRONG_CHAIN");
  if (input.receiptStatus !== "success") return reject("VENUS_RECEIPT_FAILED");
  if (!sameAddress(input.marketIdentity.market, VENUS_VNVDAB_ADDRESS) ||
      !sameAddress(input.transactionTo, input.marketIdentity.market) || !sameAddress(input.receiptTo, input.marketIdentity.market))
    return reject("VENUS_MARKET_MISMATCH");
  if (!sameAddress(input.marketIdentity.underlying, NVDAB_ADDRESS)) return reject("VENUS_UNDERLYING_MISMATCH");
  if (input.marketIdentity.symbol !== "vNVDAB" || !isAddress(input.marketIdentity.implementation) ||
      sameAddress(input.marketIdentity.implementation, "0x0000000000000000000000000000000000000000"))
    return reject("VENUS_MARKET_IDENTITY_INVALID");
  if (!sameAddress(input.transactionFrom, input.expectedWallet) || input.transactionValueRaw !== "0")
    return reject("VENUS_TRANSACTION_SEMANTICS_MISMATCH");

  let call: ReturnType<typeof decodeVenusSupplyCall>;
  try { call = decodeVenusSupplyCall(input.calldata); }
  catch { return reject("VENUS_MINT_CALL_NOT_IDENTIFIED"); }
  if (call.amountRaw !== input.expectedAmountRaw || BigInt(call.amountRaw) <= 0n) return reject("VENUS_MINT_AMOUNT_MISMATCH");
  const supplier = input.expectedWallet;
  const receiver = call.receiver ?? supplier;
  if (!sameAddress(receiver, input.expectedWallet)) return reject("VENUS_RECEIVER_MISMATCH");

  const supplyEvents: Array<{ eventType: "Mint" | "MintBehalf"; supplier: Address; receiver: Address;
    amount: bigint; tokens: bigint; accountBalanceAfter: bigint }> = [];
  const underlyingTransfers: bigint[] = [];
  const vTokenTransfers: bigint[] = [];
  for (const log of input.logs) {
    if (sameAddress(log.address, input.marketIdentity.market)) {
      try {
        const event = decodeEventLog({ abi: venusSupplyAbi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
        if (event.eventName === "Mint") supplyEvents.push({ eventType: "Mint", supplier: event.args.minter as Address,
          receiver: event.args.minter as Address, amount: event.args.mintAmount, tokens: event.args.mintTokens,
          accountBalanceAfter: event.args.totalSupply });
        if (event.eventName === "MintBehalf") supplyEvents.push({ eventType: "MintBehalf", supplier: event.args.payer as Address,
          receiver: event.args.receiver as Address, amount: event.args.mintAmount, tokens: event.args.mintTokens,
          accountBalanceAfter: event.args.totalSupply });
      } catch { /* Other market logs are not supply evidence. */ }
    }
    try {
      const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
      if (event.eventName !== "Transfer") continue;
      if (sameAddress(log.address, input.marketIdentity.underlying) && sameAddress(event.args.from, supplier) &&
          sameAddress(event.args.to, input.marketIdentity.market)) underlyingTransfers.push(event.args.value);
      if (sameAddress(log.address, input.marketIdentity.market) && sameAddress(event.args.from, input.marketIdentity.market) &&
          sameAddress(event.args.to, receiver)) vTokenTransfers.push(event.args.value);
    } catch { /* Other logs are not supply evidence. */ }
  }
  if (supplyEvents.length !== 1) return reject("VENUS_SUPPLY_EVENT_MISSING_OR_AMBIGUOUS");
  const supplied = supplyEvents[0];
  if (supplied.eventType !== call.eventType || !sameAddress(supplied.supplier, supplier)) return reject("VENUS_SUPPLIER_MISMATCH");
  if (!sameAddress(supplied.receiver, receiver)) return reject("VENUS_RECEIVER_MISMATCH");
  if (supplied.amount.toString() !== input.expectedAmountRaw || supplied.tokens <= 0n)
    return reject("VENUS_MINT_AMOUNT_MISMATCH");
  if (underlyingTransfers.length !== 1 || underlyingTransfers[0] !== supplied.amount)
    return reject("VENUS_UNDERLYING_TRANSFER_MISSING_OR_AMBIGUOUS");
  if (vTokenTransfers.length !== 1 || vTokenTransfers[0] !== supplied.tokens)
    return reject("VENUS_VTOKEN_TRANSFER_MISSING_OR_AMBIGUOUS");

  try {
    const before = BigInt(input.position.receiverVTokenBalanceBeforeRaw);
    const after = BigInt(input.position.receiverVTokenBalanceAfterRaw);
    const underlyingBefore = BigInt(input.position.marketUnderlyingBalanceBeforeRaw);
    const underlyingAfter = BigInt(input.position.marketUnderlyingBalanceAfterRaw);
    const snapshotError = BigInt(input.position.accountSnapshotAfter[0]);
    const snapshotTokens = BigInt(input.position.accountSnapshotAfter[1]);
    if (input.position.beforeBlock !== (BigInt(input.blockNumber) - 1n).toString() || input.position.afterBlock !== input.blockNumber ||
        after - before !== supplied.tokens || underlyingAfter - underlyingBefore !== supplied.amount ||
        snapshotError !== 0n || snapshotTokens !== after || supplied.accountBalanceAfter !== after)
      return reject("VENUS_POSITION_EVIDENCE_MISMATCH");
  } catch { return reject("VENUS_POSITION_EVIDENCE_MISMATCH"); }

  return { status: "VERIFIED", evidence: { transactionHash: input.transactionHash, blockNumber: input.blockNumber,
    market: input.marketIdentity.market, underlying: input.marketIdentity.underlying, supplier, receiver,
    underlyingAmountRaw: supplied.amount.toString(), vTokensMintedRaw: supplied.tokens.toString(),
    eventType: supplied.eventType, eventAccountBalanceRaw: supplied.accountBalanceAfter.toString(),
    resultingVTokenBalanceRaw: input.position.receiverVTokenBalanceAfterRaw } };
}
