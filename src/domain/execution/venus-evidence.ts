import { decodeEventLog, decodeFunctionData, erc20Abi, parseAbi, type Hex } from "viem";
import { BSC_CHAIN_ID, isAddress, sameAddress } from "@/domain/routing/identity";
import { venusVerifierProfileByMarket } from "@/domain/equities/venus-profiles";
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

export const venusRedeemAbi = parseAbi([
  "event Redeem(address redeemer, uint256 redeemAmount, uint256 redeemTokens, uint256 totalSupply)",
  "function redeem(uint256 redeemTokens) returns (uint256)",
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

export type VenusRedeemReason = "VENUS_REDEEM_CALL_NOT_IDENTIFIED" | "VENUS_REDEEM_EVENT_MISSING_OR_AMBIGUOUS" |
  "VENUS_REDEEM_AMOUNT_MISMATCH" | "VENUS_REDEEMER_MISMATCH" | "VENUS_REDEEM_TRANSFER_MISSING_OR_AMBIGUOUS" |
  "VENUS_REDEEM_VTOKEN_TRANSFER_MISSING_OR_AMBIGUOUS" |
  "VENUS_REDEEM_POSITION_EVIDENCE_MISMATCH";
export type VenusRedeemEvidence = { transactionHash: Hex; blockNumber: string; market: Address; underlying: Address;
  redeemer: Address; vTokensRedeemedRaw: string; underlyingReceivedRaw: string; resultingVTokenBalanceRaw: string };

export function decodeVenusRedeemCall(data: Hex): string {
  try {
    const decoded = decodeFunctionData({ abi: venusRedeemAbi, data });
    if (decoded.functionName === "redeem" && decoded.args[0] > 0n) return decoded.args[0].toString();
  } catch { /* Fail closed below. */ }
  throw new Error("VENUS_REDEEM_CALL_NOT_IDENTIFIED");
}

export function inspectVenusRedeem(input: {
  transactionHash: Hex; blockNumber: string; transactionFrom: Address; transactionTo: Address; transactionValueRaw: string;
  calldata: Hex; expectedWallet: Address; expectedVTokensRaw: string; logs: VenusReceiptLog[];
  position?: { beforeBlock: string; afterBlock: string; vTokenBalanceBeforeRaw: string; vTokenBalanceAfterRaw: string;
    accountSnapshotAfter: readonly [string, string, string, string]; marketUnderlyingBalanceBeforeRaw: string; marketUnderlyingBalanceAfterRaw: string };
}): { status: "VERIFIED"; evidence: VenusRedeemEvidence } | { status: "REJECTED"; reason: VenusRedeemReason } {
  const reject = (reason: VenusRedeemReason) => ({ status: "REJECTED" as const, reason });
  const profile = venusVerifierProfileByMarket(input.transactionTo);
  if (!profile || !sameAddress(input.transactionFrom, input.expectedWallet) || input.transactionValueRaw !== "0")
    return reject("VENUS_REDEEMER_MISMATCH");
  if (!profile.redeemSelectors.includes(input.calldata.slice(0, 10).toLowerCase() as `0x${string}`))
    return reject("VENUS_REDEEM_CALL_NOT_IDENTIFIED");
  let called: string;
  try { called = decodeVenusRedeemCall(input.calldata); } catch { return reject("VENUS_REDEEM_CALL_NOT_IDENTIFIED"); }
  if (called !== input.expectedVTokensRaw) return reject("VENUS_REDEEM_AMOUNT_MISMATCH");
  const events: Array<{ redeemer: Address; underlying: bigint; tokens: bigint; balance: bigint }> = [];
  const transfers: bigint[] = [];
  const vTokenTransfers: bigint[] = [];
  for (const log of input.logs) {
    if (sameAddress(log.address, profile.market)) {
      try {
        const decoded = decodeEventLog({ abi: venusRedeemAbi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
        if (decoded.eventName === "Redeem") events.push({ redeemer: decoded.args.redeemer as Address, underlying: decoded.args.redeemAmount,
          tokens: decoded.args.redeemTokens, balance: decoded.args.totalSupply });
      } catch { /* Ignore unrelated market logs. */ }
    }
    if (sameAddress(log.address, profile.underlyingToken)) {
      try {
        const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
        if (decoded.eventName === "Transfer" && sameAddress(decoded.args.from, profile.market) && sameAddress(decoded.args.to, input.expectedWallet))
          transfers.push(decoded.args.value);
      } catch { /* Ignore unrelated underlying logs. */ }
    }
    if (sameAddress(log.address, profile.market)) {
      try {
        const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
        if (decoded.eventName === "Transfer" && sameAddress(decoded.args.from, input.expectedWallet) &&
            sameAddress(decoded.args.to, profile.market)) vTokenTransfers.push(decoded.args.value);
      } catch { /* Ignore unrelated market logs. */ }
    }
  }
  if (events.length !== 1) return reject("VENUS_REDEEM_EVENT_MISSING_OR_AMBIGUOUS");
  const event = events[0];
  if (!sameAddress(event.redeemer, input.expectedWallet)) return reject("VENUS_REDEEMER_MISMATCH");
  if (event.tokens.toString() !== input.expectedVTokensRaw || event.underlying <= 0n) return reject("VENUS_REDEEM_AMOUNT_MISMATCH");
  if (transfers.length !== 1 || transfers[0] !== event.underlying) return reject("VENUS_REDEEM_TRANSFER_MISSING_OR_AMBIGUOUS");
  if (vTokenTransfers.length !== 1 || vTokenTransfers[0] !== event.tokens)
    return reject("VENUS_REDEEM_VTOKEN_TRANSFER_MISSING_OR_AMBIGUOUS");
  if (input.position) {
    try {
      const before = BigInt(input.position.vTokenBalanceBeforeRaw), after = BigInt(input.position.vTokenBalanceAfterRaw);
      const underlyingBefore = BigInt(input.position.marketUnderlyingBalanceBeforeRaw), underlyingAfter = BigInt(input.position.marketUnderlyingBalanceAfterRaw);
      const snapshotError = BigInt(input.position.accountSnapshotAfter[0]), snapshotTokens = BigInt(input.position.accountSnapshotAfter[1]);
      if (input.position.beforeBlock !== (BigInt(input.blockNumber) - 1n).toString() || input.position.afterBlock !== input.blockNumber ||
          before - after !== event.tokens || underlyingBefore - underlyingAfter !== event.underlying || snapshotError !== 0n ||
          snapshotTokens !== after || event.balance !== after) return reject("VENUS_REDEEM_POSITION_EVIDENCE_MISMATCH");
    } catch { return reject("VENUS_REDEEM_POSITION_EVIDENCE_MISMATCH"); }
  }
  return { status: "VERIFIED", evidence: { transactionHash: input.transactionHash, blockNumber: input.blockNumber,
    market: profile.market, underlying: profile.underlyingToken, redeemer: input.expectedWallet,
    vTokensRedeemedRaw: event.tokens.toString(), underlyingReceivedRaw: event.underlying.toString(),
    resultingVTokenBalanceRaw: event.balance.toString() } };
}

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
  position?: {
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
  const profile = venusVerifierProfileByMarket(input.marketIdentity.market);
  if (!profile ||
      !sameAddress(input.transactionTo, input.marketIdentity.market) || !sameAddress(input.receiptTo, input.marketIdentity.market))
    return reject("VENUS_MARKET_MISMATCH");
  if (!sameAddress(input.marketIdentity.underlying, profile.underlyingToken)) return reject("VENUS_UNDERLYING_MISMATCH");
  if (input.marketIdentity.symbol !== profile.marketSymbol || !isAddress(input.marketIdentity.implementation) ||
      !sameAddress(input.marketIdentity.implementation, profile.implementation))
    return reject("VENUS_MARKET_IDENTITY_INVALID");
  if (!sameAddress(input.transactionFrom, input.expectedWallet) || input.transactionValueRaw !== "0")
    return reject("VENUS_TRANSACTION_SEMANTICS_MISMATCH");

  let call: ReturnType<typeof decodeVenusSupplyCall>;
  try { call = decodeVenusSupplyCall(input.calldata); }
  catch { return reject("VENUS_MINT_CALL_NOT_IDENTIFIED"); }
  if (!profile.depositSelectors.includes(input.calldata.slice(0, 10).toLowerCase() as `0x${string}`) ||
      !profile.supplyEvents.includes(call.eventType)) return reject("VENUS_MINT_CALL_NOT_IDENTIFIED");
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

  if (input.position) try {
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
    resultingVTokenBalanceRaw: input.position?.receiverVTokenBalanceAfterRaw ?? supplied.accountBalanceAfter.toString() } };
}
