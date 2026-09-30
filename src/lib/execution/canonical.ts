import "server-only";
import { decodeEventLog, erc20Abi, TransactionNotFoundError, TransactionReceiptNotFoundError, type Hex } from "viem";
import { matchTransactionSemantics, type ExecutionActionV1 } from "@/domain/execution/action";
import { NVDAB_ADDRESS, sameAddress, VENUS_VNVDAB_ADDRESS } from "@/domain/routing/identity";
import { decodeVenusSupplyCall, inspectVenusSupply, inspectVenusRedeem, venusMarketReadAbi, type VenusRedeemEvidence, type VenusRedeemReason, type VenusSupplyEvidence, type VenusSupplyReason } from "@/domain/execution/venus-evidence";
import { bscPublicClient, readBscWithRetry } from "@/lib/execution/rpc";
import type { Address } from "@/types/route";

export type CanonicalObservation =
  | { status: "PENDING"; reason: "TRANSACTION_NOT_FOUND" | "RECEIPT_NOT_FOUND" | "CONFIRMATIONS_PENDING" | "FINALITY_PENDING" }
  | { status: "FAILED"; reason: "RECEIPT_REVERTED" | "CANONICAL_ACTION_MISMATCH" | "BLOCK_IDENTITY_MISMATCH" | "APPROVAL_EVIDENCE_MISSING" | "SETTLEMENT_EVIDENCE_MISSING" | VenusSupplyReason | VenusRedeemReason }
  | { status: "CONFIRMED"; txHash: Hex; blockNumber: string; blockHash: Hex; from: Address; to: Address;
      confirmedAt: string; confirmations: string; gas: { nonce: number; gasLimit: string; gasPrice: string | null; effectiveGasPrice: string | null };
      transfers: Array<{ token: Address; from: Address; to: Address; amountRaw: string; logIndex: number }>;
      settlement: { amountInRaw: string; amountOutRaw: string; inLogIndex: number; outLogIndex: number } | null;
      venusSupply: VenusSupplyEvidence | null; venusRedeem: VenusRedeemEvidence | null };

export function finalityPolicy(environment: Record<string, string | undefined> = process.env): { minConfirmations: bigint; requireFinalized: boolean } {
  const value = environment.BSC_MIN_CONFIRMATIONS ?? "3";
  if (!/^[1-9]\d*$/.test(value) || BigInt(value) > 100n) throw new Error("INVALID_FINALITY_POLICY");
  return { minConfirmations: BigInt(value), requireFinalized: environment.BSC_REQUIRE_FINALIZED === "true" };
}

export function decodeTransfers(logs: Array<{ address: Address; data: Hex; topics: readonly Hex[]; logIndex: number | null }>) {
  return logs.flatMap(log => {
    try {
      if (log.topics.length === 0) return [];
      const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
      if (event.eventName !== "Transfer" || log.logIndex === null) return [];
      return [{ token: log.address, from: event.args.from, to: event.args.to, amountRaw: event.args.value.toString(), logIndex: log.logIndex }];
    } catch { return []; }
  });
}

export function exactSettlementFromTransfers(input: {
  transfers: ReturnType<typeof decodeTransfers>; wallet: Address; tokenIn: Address; tokenOut: Address;
}): { amountInRaw: string; amountOutRaw: string; inLogIndex: number; outLogIndex: number } {
  const debits = input.transfers.filter(x => sameAddress(x.token, input.tokenIn) && sameAddress(x.from, input.wallet));
  const credits = input.transfers.filter(x => sameAddress(x.token, input.tokenOut) && sameAddress(x.to, input.wallet));
  if (debits.length !== 1 || credits.length !== 1 || BigInt(debits[0].amountRaw) <= 0n || BigInt(credits[0].amountRaw) <= 0n)
    throw new Error("SETTLEMENT_LOGS_MISSING_OR_AMBIGUOUS");
  return { amountInRaw: debits[0].amountRaw, amountOutRaw: credits[0].amountRaw,
    inLogIndex: debits[0].logIndex, outLogIndex: credits[0].logIndex };
}

export function hasExactApprovalLog(logs: Array<{ address: Address; data: Hex; topics: readonly Hex[] }>, action: ExecutionActionV1): boolean {
  if (action.kind !== "APPROVAL") return false;
  return logs.some(log => {
    if (!sameAddress(log.address, action.tokenIn) || log.topics.length === 0) return false;
    try {
      const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
      return event.eventName === "Approval" && sameAddress(event.args.owner, action.from) &&
        sameAddress(event.args.spender, action.approvalSpender ?? "") && event.args.value.toString() === action.approvalAmountRaw;
    } catch { return false; }
  });
}

export async function observeCanonicalTransaction(hash: Hex, action: ExecutionActionV1): Promise<CanonicalObservation> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error("INVALID_TRANSACTION_HASH");
  const client = bscPublicClient();
  if (await readBscWithRetry(() => client.getChainId()) !== 56) throw new Error("WRONG_RPC_CHAIN");
  let tx;
  try { tx = await readBscWithRetry(() => client.getTransaction({ hash })); }
  catch (error) { if (error instanceof TransactionNotFoundError) return { status: "PENDING", reason: "TRANSACTION_NOT_FOUND" }; throw error; }
  try { matchTransactionSemantics(action, { from: tx.from, to: tx.to, input: tx.input, value: tx.value, chainId: tx.chainId ?? -1 }); }
  catch { return { status: "FAILED", reason: "CANONICAL_ACTION_MISMATCH" }; }
  let receipt;
  try { receipt = await readBscWithRetry(() => client.getTransactionReceipt({ hash })); }
  catch (error) { if (error instanceof TransactionReceiptNotFoundError) return { status: "PENDING", reason: "RECEIPT_NOT_FOUND" }; throw error; }
  if (receipt.status !== "success") return { status: "FAILED", reason: "RECEIPT_REVERTED" };
  if (tx.blockHash !== receipt.blockHash || tx.blockNumber !== receipt.blockNumber ||
      !sameAddress(receipt.from, action.from) || !sameAddress(receipt.to ?? "", action.to))
    return { status: "FAILED", reason: "BLOCK_IDENTITY_MISMATCH" };
  const block = await readBscWithRetry(() => client.getBlock({ blockNumber: receipt.blockNumber }));
  if (block.hash !== receipt.blockHash) return { status: "FAILED", reason: "BLOCK_IDENTITY_MISMATCH" };
  const head = await readBscWithRetry(() => client.getBlockNumber());
  const confirmations = head - receipt.blockNumber + 1n;
  const policy = finalityPolicy();
  if (confirmations < policy.minConfirmations) return { status: "PENDING", reason: "CONFIRMATIONS_PENDING" };
  if (policy.requireFinalized) {
    try {
      const finalized = await readBscWithRetry(() => client.getBlock({ blockTag: "finalized" }));
      if (finalized.number < receipt.blockNumber) return { status: "PENDING", reason: "FINALITY_PENDING" };
    } catch { return { status: "PENDING", reason: "FINALITY_PENDING" }; }
  }
  const transfers = decodeTransfers(receipt.logs.map(log => ({ address: log.address, data: log.data, topics: log.topics,
    logIndex: log.logIndex })));
  if (action.kind === "APPROVAL" && !hasExactApprovalLog(receipt.logs, action)) return { status: "FAILED", reason: "APPROVAL_EVIDENCE_MISSING" };
  let actual: Extract<CanonicalObservation, { status: "CONFIRMED" }>["settlement"] = null;
  if (action.kind === "SWAP") {
    if (!action.tokenOut) return { status: "FAILED", reason: "SETTLEMENT_EVIDENCE_MISSING" };
    try {
      actual = exactSettlementFromTransfers({ transfers, wallet: action.from, tokenIn: action.tokenIn, tokenOut: action.tokenOut });
      if (actual.amountInRaw !== action.amountInRaw) return { status: "FAILED", reason: "SETTLEMENT_EVIDENCE_MISSING" };
    } catch { return { status: "FAILED", reason: "SETTLEMENT_EVIDENCE_MISSING" }; }
  }
  let venusSupply: VenusSupplyEvidence | null = null;
  let venusRedeem: VenusRedeemEvidence | null = null;
  if (action.kind === "DEPOSIT") {
    if (!sameAddress(action.to, VENUS_VNVDAB_ADDRESS) || !sameAddress(action.tokenIn, NVDAB_ADDRESS))
      return { status: "FAILED", reason: "VENUS_MARKET_MISMATCH" };
    let call;
    try { call = decodeVenusSupplyCall(action.data); }
    catch { return { status: "FAILED", reason: "VENUS_MINT_CALL_NOT_IDENTIFIED" }; }
    const receiver = call.receiver ?? action.from;
    const beforeBlock = receipt.blockNumber - 1n;
    const [underlying, symbol, implementation, balanceBefore, balanceAfter, snapshotAfter, underlyingBefore, underlyingAfter] =
      await Promise.all([
        readBscWithRetry(() => client.readContract({ address: action.to, abi: venusMarketReadAbi, functionName: "underlying" })),
        readBscWithRetry(() => client.readContract({ address: action.to, abi: venusMarketReadAbi, functionName: "symbol" })),
        readBscWithRetry(() => client.readContract({ address: action.to, abi: venusMarketReadAbi, functionName: "implementation" })),
        readBscWithRetry(() => client.readContract({ address: action.to, abi: venusMarketReadAbi, functionName: "balanceOf", args: [receiver], blockNumber: beforeBlock })),
        readBscWithRetry(() => client.readContract({ address: action.to, abi: venusMarketReadAbi, functionName: "balanceOf", args: [receiver], blockNumber: receipt.blockNumber })),
        readBscWithRetry(() => client.readContract({ address: action.to, abi: venusMarketReadAbi, functionName: "getAccountSnapshot", args: [receiver], blockNumber: receipt.blockNumber })),
        readBscWithRetry(() => client.readContract({ address: NVDAB_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [action.to], blockNumber: beforeBlock })),
        readBscWithRetry(() => client.readContract({ address: NVDAB_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [action.to], blockNumber: receipt.blockNumber })),
      ]);
    const inspected = inspectVenusSupply({ chainId: 56, transactionHash: hash, transactionFrom: tx.from,
      transactionTo: tx.to!, transactionValueRaw: tx.value.toString(), calldata: tx.input, receiptStatus: receipt.status,
      receiptTo: receipt.to!, blockNumber: receipt.blockNumber.toString(), expectedWallet: action.from,
      expectedAmountRaw: action.amountInRaw, marketIdentity: { market: action.to, underlying, symbol, implementation },
      logs: receipt.logs, position: { beforeBlock: beforeBlock.toString(), afterBlock: receipt.blockNumber.toString(),
        receiverVTokenBalanceBeforeRaw: balanceBefore.toString(), receiverVTokenBalanceAfterRaw: balanceAfter.toString(),
        accountSnapshotAfter: snapshotAfter.map(x => x.toString()) as [string, string, string, string],
        marketUnderlyingBalanceBeforeRaw: underlyingBefore.toString(), marketUnderlyingBalanceAfterRaw: underlyingAfter.toString() } });
    if (inspected.status === "REJECTED") return { status: "FAILED", reason: inspected.reason };
    venusSupply = inspected.evidence;
  }
  if (action.kind === "REDEEM") {
    if (!sameAddress(action.to, VENUS_VNVDAB_ADDRESS) || !sameAddress(action.tokenIn, VENUS_VNVDAB_ADDRESS) ||
        !sameAddress(action.tokenOut ?? "", NVDAB_ADDRESS)) return { status: "FAILED", reason: "VENUS_MARKET_MISMATCH" };
    const beforeBlock = receipt.blockNumber - 1n;
    const [balanceBefore, balanceAfter, snapshotAfter, underlyingBefore, underlyingAfter] = await Promise.all([
      readBscWithRetry(() => client.readContract({ address: action.to, abi: venusMarketReadAbi, functionName: "balanceOf", args: [action.from], blockNumber: beforeBlock })),
      readBscWithRetry(() => client.readContract({ address: action.to, abi: venusMarketReadAbi, functionName: "balanceOf", args: [action.from], blockNumber: receipt.blockNumber })),
      readBscWithRetry(() => client.readContract({ address: action.to, abi: venusMarketReadAbi, functionName: "getAccountSnapshot", args: [action.from], blockNumber: receipt.blockNumber })),
      readBscWithRetry(() => client.readContract({ address: NVDAB_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [action.to], blockNumber: beforeBlock })),
      readBscWithRetry(() => client.readContract({ address: NVDAB_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [action.to], blockNumber: receipt.blockNumber })),
    ]);
    const inspected = inspectVenusRedeem({ transactionHash: hash, blockNumber: receipt.blockNumber.toString(), transactionFrom: tx.from,
      transactionTo: tx.to!, transactionValueRaw: tx.value.toString(), calldata: tx.input, expectedWallet: action.from,
      expectedVTokensRaw: action.amountInRaw, logs: receipt.logs,
      position: { beforeBlock: beforeBlock.toString(), afterBlock: receipt.blockNumber.toString(),
        vTokenBalanceBeforeRaw: balanceBefore.toString(), vTokenBalanceAfterRaw: balanceAfter.toString(),
        accountSnapshotAfter: snapshotAfter.map(x => x.toString()) as [string,string,string,string],
        marketUnderlyingBalanceBeforeRaw: underlyingBefore.toString(), marketUnderlyingBalanceAfterRaw: underlyingAfter.toString() } });
    if (inspected.status === "REJECTED") return { status: "FAILED", reason: inspected.reason };
    venusRedeem = inspected.evidence;
    actual = { amountInRaw: inspected.evidence.vTokensRedeemedRaw, amountOutRaw: inspected.evidence.underlyingReceivedRaw,
      inLogIndex: -1, outLogIndex: transfers.find(x => sameAddress(x.token, NVDAB_ADDRESS) && sameAddress(x.from, action.to) && sameAddress(x.to, action.from))?.logIndex ?? -1 };
  }
  return { status: "CONFIRMED", txHash: hash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
    from: tx.from, to: tx.to!, confirmedAt: new Date(Number(block.timestamp) * 1000).toISOString(), confirmations: confirmations.toString(),
    gas: { nonce: tx.nonce, gasLimit: tx.gas.toString(), gasPrice: tx.gasPrice?.toString() ?? null,
      effectiveGasPrice: receipt.effectiveGasPrice?.toString() ?? null }, transfers, settlement: actual, venusSupply, venusRedeem };
}

export function venusSupplyVerificationReadiness(): "READY" { return "READY"; }
