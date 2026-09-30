import "server-only";
import type { Hex } from "viem";
import { classifyLostHash, type LostHashDecision, type RecoveryTransaction } from "@/domain/execution/lost-hash";
import { executionActionHash, type ExecutionActionV1 } from "@/domain/execution/action";
import { executionPool } from "@/lib/db/pool";
import { bscPublicClient, readBscWithRetry } from "./rpc";
import { observeCanonicalTransaction } from "./canonical";

export type RecoveryResult = LostHashDecision | { status: "CANDIDATE_PENDING"; hash: Hex };

// Read-only bounded search. A zero-match result is never proof that the wallet did not broadcast.
export async function findReservedTransaction(routeId: string, wallet: string, stepId: string): Promise<RecoveryResult> {
  const result = await executionPool().query(`SELECT s.action_v1,s.action_hash,s.status,s.reserved_at,s.tx_hash FROM execution_steps s
    JOIN execution_routes r ON r.route_id=s.route_id WHERE s.step_id=$1 AND s.route_id=$2 AND r.wallet=$3`,
    [stepId, routeId, wallet.toLowerCase()]);
  const row = result.rows[0] as { action_v1: ExecutionActionV1; action_hash: string; status: string; reserved_at: Date | null; tx_hash: string | null } | undefined;
  if (!row || row.status !== "AWAITING_WALLET_TX" || row.tx_hash || !row.reserved_at ||
      executionActionHash(row.action_v1) !== row.action_hash) throw new Error("ACTION_RESERVATION_REQUIRED");
  if (Date.now() - row.reserved_at.getTime() > 8 * 60_000) return { status: "UNRESOLVED", reason: "WINDOW_EXCEEDED" };
  const client = bscPublicClient();
  if (await readBscWithRetry(() => client.getChainId()) !== 56) throw new Error("WRONG_RPC_CHAIN");
  const head = await readBscWithRetry(() => client.getBlockNumber());
  const earliest = head > 128n ? head - 128n : 0n;
  const oldest = await readBscWithRetry(() => client.getBlock({ blockNumber: earliest }));
  if (earliest > 0n && Number(oldest.timestamp) * 1000 > row.reserved_at.getTime() - 30_000)
    return { status: "UNRESOLVED", reason: "WINDOW_EXCEEDED" };
  const possible: RecoveryTransaction[] = [];
  for (let first = earliest; first <= head; first += 4n) {
    const numbers = [first, first + 1n, first + 2n, first + 3n].filter(number => number <= head);
    const blocks = await Promise.all(numbers.map(blockNumber => readBscWithRetry(() => client.getBlock({ blockNumber, includeTransactions: true }))));
    for (const block of blocks) {
      if (Number(block.timestamp) * 1000 < row.reserved_at.getTime() - 30_000) continue;
      for (const tx of block.transactions) {
        if (typeof tx === "string" || tx.from.toLowerCase() !== wallet.toLowerCase()) continue;
        possible.push({ hash: tx.hash, from: tx.from, to: tx.to, input: tx.input,
          value: tx.value, chainId: tx.chainId ?? -1, blockNumber: block.number });
      }
    }
  }
  const decision = classifyLostHash(row.action_v1, possible);
  if (decision.status !== "CANDIDATE") return decision;
  const evidence = await observeCanonicalTransaction(decision.hash, row.action_v1);
  if (evidence.status === "FAILED") return { status: "UNRESOLVED", reason: "CANONICAL_EVIDENCE_FAILED" };
  if (evidence.status === "PENDING") return { status: "CANDIDATE_PENDING", hash: decision.hash };
  return decision;
}
