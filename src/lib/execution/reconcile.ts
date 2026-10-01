import "server-only";
import type { Hex } from "viem";
import { randomUUID } from "node:crypto";
import { executionActionHash, type ExecutionActionV1 } from "@/domain/execution/action";
import { observeTransaction, measureSettlement, submitPlannedAction } from "@/domain/execution/lifecycle";
import { beginVenusRecovery, observeRecoveryAction, recordRecoveredUsdt, recordRedeemedNvdab, recoveryAfterProductStop, submitRecoveryAction } from "@/domain/execution/recovery";
import { observeTestSetup, submitTestSetup, verifyTestSetupSettlement } from "@/domain/execution/test-setup";
import { deriveSettlement } from "@/domain/execution/settlement";
import { sameAddress } from "@/domain/routing/identity";
import { executionPool, transaction } from "@/lib/db/pool";
import { observeCanonicalTransaction } from "@/lib/execution/canonical";
import { persistRoundTripReceipt } from "@/lib/execution/round-trip-receipt";
import type { ConfirmationBoundary, ConfirmedTransaction, ExecutionSession, TransactionObservation } from "@/types/execution";
import type { Address } from "@/types/route";

function boundary(stage: ExecutionActionV1["stage"]): ConfirmationBoundary {
  if (stage.startsWith("LEG1")) return "LEAVE_ONDO";
  if (stage.startsWith("LEG2")) return "CHANGE_REPRESENTATION";
  if (stage === "VENUS_REDEEM") return "REDEEM_VENUS";
  if (stage.startsWith("EXIT")) return "EXIT_TO_USDT";
  if (stage.startsWith("TEST_SETUP")) return "TEST_SETUP";
  return "SUPPLY_TO_VENUS";
}
function observationKey(stage: ExecutionActionV1["stage"]): "APPROVAL" | "SWAP" | "DEPOSIT" | "REDEEM" {
  return stage.endsWith("APPROVAL") ? "APPROVAL" : stage.endsWith("DEPOSIT") ? "DEPOSIT" : stage.endsWith("REDEEM") ? "REDEEM" : "SWAP";
}

// A browser hash is a lookup hint. The chain transaction must match the persisted action before recording it.
export async function acceptReportedHash(routeId: string, wallet: Address, stepId: string, hash: Hex): Promise<void> {
  const candidate = await executionPool().query(`SELECT s.action_v1,s.action_hash,s.status,s.tx_hash,r.wallet
    FROM execution_steps s JOIN execution_routes r ON r.route_id=s.route_id
    WHERE s.step_id=$1 AND s.route_id=$2 AND r.wallet=$3`, [stepId,routeId,wallet.toLowerCase()]);
  if (candidate.rowCount !== 1) throw new Error("STEP_NOT_FOUND");
  const row = candidate.rows[0] as { action_v1: ExecutionActionV1; action_hash: string; status: string; tx_hash: string | null; wallet: string };
  if (row.tx_hash?.toLowerCase() === hash.toLowerCase()) return;
  if (row.status !== "AWAITING_WALLET_TX" || executionActionHash(row.action_v1) !== row.action_hash) throw new Error("ACTION_RESERVATION_REQUIRED");
  const onchain = await observeCanonicalTransaction(hash, row.action_v1);
  if (onchain.status === "PENDING" && onchain.reason === "TRANSACTION_NOT_FOUND") throw new Error("UNRECOGNIZED_TRANSACTION_HASH");
  if (onchain.status === "FAILED" && onchain.reason === "CANONICAL_ACTION_MISMATCH") throw new Error("CANONICAL_ACTION_MISMATCH");
  await transaction(async client => {
    const route = await client.query("SELECT session_snapshot,wallet FROM execution_routes WHERE route_id=$1 FOR UPDATE", [routeId]);
    const step = await client.query("SELECT status,action_hash,tx_hash,action_v1 FROM execution_steps WHERE step_id=$1 AND route_id=$2 FOR UPDATE", [stepId,routeId]);
    if (route.rowCount !== 1 || step.rowCount !== 1 || !sameAddress(route.rows[0].wallet, wallet) ||
        step.rows[0].status !== "AWAITING_WALLET_TX" || step.rows[0].tx_hash || step.rows[0].action_hash !== row.action_hash)
      throw new Error("CONCURRENT_STEP_CONFLICT");
    const action = step.rows[0].action_v1 as ExecutionActionV1;
    const session = route.rows[0].session_snapshot as ExecutionSession;
    const key = observationKey(action.stage);
    const next = action.stage.startsWith("TEST_SETUP_") ? submitTestSetup(session, action, { status: "SUBMITTED", transactionHash: hash }) :
      key === "REDEEM" || action.stage.startsWith("EXIT_") ?
      submitRecoveryAction(session, action, { status: "SUBMITTED", transactionHash: hash }) :
      submitPlannedAction(session, boundary(action.stage) as "LEAVE_ONDO" | "CHANGE_REPRESENTATION" | "SUPPLY_TO_VENUS", key as "APPROVAL" | "SWAP" | "DEPOSIT", { status: "SUBMITTED", transactionHash: hash });
    await client.query("UPDATE execution_steps SET tx_hash=$2,status='SUBMITTED',updated_at=now() WHERE step_id=$1", [stepId,hash.toLowerCase()]);
    await client.query("UPDATE execution_routes SET session_snapshot=$2,lifecycle_state=$3,version=version+1,updated_at=now() WHERE route_id=$1",
      [routeId,JSON.stringify(next),next.stage]);
  });
}

export async function reconcileStoredStep(routeId: string, wallet: Address, stepId: string): Promise<"PENDING" | "FAILED" | "CONFIRMED"> {
  const candidate = await executionPool().query(`SELECT s.action_v1,s.action_hash,s.tx_hash,s.status FROM execution_steps s
    JOIN execution_routes r ON r.route_id=s.route_id WHERE s.route_id=$1 AND s.step_id=$2 AND r.wallet=$3`, [routeId,stepId,wallet.toLowerCase()]);
  if (candidate.rowCount !== 1) throw new Error("STEP_NOT_FOUND");
  const row = candidate.rows[0] as { action_v1: ExecutionActionV1; action_hash: string; tx_hash: Hex | null; status: string };
  if (row.status === "CONFIRMED") return "CONFIRMED";
  if (!row.tx_hash || !["SUBMITTED", "PENDING"].includes(row.status) || executionActionHash(row.action_v1) !== row.action_hash)
    throw new Error("SUBMITTED_STEP_REQUIRED");
  const evidence = await observeCanonicalTransaction(row.tx_hash, row.action_v1);
  if (evidence.status === "PENDING") {
    if (evidence.reason !== "TRANSACTION_NOT_FOUND") await executionPool().query("UPDATE execution_steps SET status='PENDING',updated_at=now() WHERE step_id=$1 AND status IN ('SUBMITTED','PENDING')", [stepId]);
    return "PENDING";
  }
  const observation: TransactionObservation = evidence.status === "FAILED" ? { status: "FAILED", transactionHash: row.tx_hash, reason: evidence.reason } :
    { status: "CONFIRMED", transactionHash: evidence.txHash, blockNumber: evidence.blockNumber,
      from: evidence.from, to: evidence.to, confirmedAt: evidence.confirmedAt,
      tokenTransfers: evidence.transfers.map(x => ({ ...x, logIndex: x.logIndex })) } satisfies ConfirmedTransaction;
  return transaction(async client => {
    const route = await client.query("SELECT session_snapshot FROM execution_routes WHERE route_id=$1 AND wallet=$2 FOR UPDATE", [routeId,wallet.toLowerCase()]);
    const current = await client.query("SELECT status,tx_hash,action_hash FROM execution_steps WHERE step_id=$1 AND route_id=$2 FOR UPDATE", [stepId,routeId]);
    if (route.rowCount !== 1 || current.rowCount !== 1 || current.rows[0].action_hash !== row.action_hash ||
        current.rows[0].tx_hash?.toLowerCase() !== row.tx_hash?.toLowerCase()) throw new Error("CONCURRENT_STEP_CONFLICT");
    if (current.rows[0].status === "CONFIRMED") return "CONFIRMED";
    if (!["SUBMITTED", "PENDING"].includes(current.rows[0].status)) throw new Error("CONCURRENT_STEP_CONFLICT");
    const session = route.rows[0].session_snapshot as ExecutionSession;
    const setupAction = row.action_v1.stage.startsWith("TEST_SETUP_");
    const recoveryAction = row.action_v1.kind === "REDEEM" || row.action_v1.stage.startsWith("EXIT_");
    let next = setupAction ? observeTestSetup(session, row.action_v1, observation) : recoveryAction ? observeRecoveryAction(session, row.action_v1, observation) :
      observeTransaction(session, boundary(row.action_v1.stage) as "LEAVE_ONDO" | "CHANGE_REPRESENTATION" | "SUPPLY_TO_VENUS",
        observationKey(row.action_v1.stage) as "APPROVAL" | "SWAP" | "DEPOSIT", observation);
    if (evidence.status === "CONFIRMED" && row.action_v1.kind === "DEPOSIT" && evidence.venusSupply) {
      next = beginVenusRecovery(next, { market: evidence.venusSupply.market, investmentId: next.venus!.investmentId,
        underlyingAmountRaw: evidence.venusSupply.underlyingAmountRaw, vTokenAmountRaw: evidence.venusSupply.vTokensMintedRaw,
        transactionHash: evidence.txHash, blockNumber: evidence.blockNumber });
    }
    if (evidence.status === "CONFIRMED" && row.action_v1.kind === "SWAP") {
      const leg = row.action_v1.stage === "TEST_SETUP_SWAP" ? "SETUP" : row.action_v1.stage === "LEG1_SWAP" ? "LEG1" : row.action_v1.stage === "LEG2_SWAP" ? "LEG2" : "EXIT";
      const settlement = deriveSettlement(observation as ConfirmedTransaction, row.action_v1.from, row.action_v1.tokenIn, row.action_v1.tokenOut!);
      next = leg === "SETUP" ? verifyTestSetupSettlement(next, settlement) : leg === "EXIT" ? recordRecoveredUsdt(next, settlement) : measureSettlement(next, leg, settlement);
      await client.query(`INSERT INTO settlement_evidence(evidence_id,route_id,stage,tx_hash,block_number,block_hash,token_in,token_out,
        amount_in_raw,amount_out_raw,log_references,evidence_source,confirmed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'BSC_CANONICAL_RPC',$12)`,
        [randomUUID(),routeId,row.action_v1.stage,row.tx_hash,evidence.blockNumber,evidence.blockHash,row.action_v1.tokenIn,row.action_v1.tokenOut,
          settlement.actualAmountInRaw,settlement.actualAmountOutRaw,JSON.stringify(evidence.settlement),evidence.confirmedAt]);
    }
    if (evidence.status === "CONFIRMED" && row.action_v1.kind === "REDEEM" && evidence.venusRedeem) {
      const settlement = { ...(observation as ConfirmedTransaction), actualAmountInRaw: evidence.venusRedeem.vTokensRedeemedRaw,
        actualAmountOutRaw: evidence.venusRedeem.underlyingReceivedRaw, outputToken: row.action_v1.tokenOut!, outputRecipient: row.action_v1.from };
      next = recordRedeemedNvdab(next, settlement);
      await client.query(`INSERT INTO settlement_evidence(evidence_id,route_id,stage,tx_hash,block_number,block_hash,token_in,token_out,
        amount_in_raw,amount_out_raw,log_references,evidence_source,confirmed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'BSC_CANONICAL_RPC',$12)`,
        [randomUUID(),routeId,row.action_v1.stage,row.tx_hash,evidence.blockNumber,evidence.blockHash,row.action_v1.tokenIn,row.action_v1.tokenOut,
          settlement.actualAmountInRaw,settlement.actualAmountOutRaw,JSON.stringify(evidence.venusRedeem),evidence.confirmedAt]);
    }
    await client.query("UPDATE execution_steps SET status=$2,confirmed_block=$3,failure_reason=$4,updated_at=now() WHERE step_id=$1",
      [stepId,evidence.status,evidence.status === "CONFIRMED" ? evidence.blockNumber : null,evidence.status === "FAILED" ? evidence.reason : null]);
    if (evidence.status === "CONFIRMED" && row.action_v1.stage === "EXIT_SWAP")
      await persistRoundTripReceipt(client, next, evidence.confirmedAt);
    await client.query("UPDATE execution_routes SET session_snapshot=$2,lifecycle_state=$3,recovery_state=$4,version=version+1,updated_at=now() WHERE route_id=$1",
      [routeId,JSON.stringify(next),next.stage,recoveryAfterProductStop(next)]);
    return evidence.status;
  });
}
