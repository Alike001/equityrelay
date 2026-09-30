import { matchTransactionSemantics, type ExecutionActionV1 } from "./action";

export type RecoveryTransaction = { hash: `0x${string}`; from: string; to: string | null; input: string; value: bigint; chainId: number; blockNumber: bigint };
export type LostHashDecision =
  | { status: "UNRESOLVED"; reason: "NO_MATCH" | "WINDOW_EXCEEDED" | "CANONICAL_EVIDENCE_FAILED" }
  | { status: "AMBIGUOUS"; matches: number }
  | { status: "CANDIDATE"; hash: `0x${string}`; blockNumber: string };

export function classifyLostHash(action: ExecutionActionV1, transactions: readonly RecoveryTransaction[]): LostHashDecision {
  const matches = transactions.filter(tx => {
    try { matchTransactionSemantics(action, tx); return true; } catch { return false; }
  });
  if (matches.length === 0) return { status: "UNRESOLVED", reason: "NO_MATCH" };
  if (matches.length !== 1) return { status: "AMBIGUOUS", matches: matches.length };
  return { status: "CANDIDATE", hash: matches[0].hash, blockNumber: matches[0].blockNumber.toString() };
}
