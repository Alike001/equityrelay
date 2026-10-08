import "server-only";
import type { ExecutionActionV1 } from "@/domain/execution/action";
import { recoveryAfterProductStop } from "@/domain/execution/recovery";
import { executionPool, transaction } from "@/lib/db/pool";
import { prepareInitialExecutionReview } from "@/lib/execution/initial-review";
import { prepareDurableLeg2Review } from "@/lib/execution/post-settlement";
import { prepareDurableExitReview } from "@/lib/execution/recovery-review";
import { prepareDurableTestSetupReview } from "@/lib/execution/test-setup-review";
import { quoteForAction, requireCurrentQuote } from "@/lib/execution/readiness";
import type { ExecutionSession } from "@/types/execution";
import type { Address } from "@/types/route";

function withoutReview(session: ExecutionSession, key: keyof ExecutionSession["reviews"]): ExecutionSession["reviews"] {
  const reviews = { ...session.reviews };
  delete reviews[key];
  return reviews;
}

export async function invalidateStaleQuoteReview(routeId: string, wallet: Address, stepId: string,
  expectedActionHash: string): Promise<ExecutionActionV1["stage"]> {
  return transaction(async client => {
    const route = await client.query("SELECT version,session_snapshot FROM execution_routes WHERE route_id=$1 AND wallet=$2 FOR UPDATE",
      [routeId,wallet.toLowerCase()]);
    const step = await client.query("SELECT stage,action_hash,status FROM execution_steps WHERE route_id=$1 AND step_id=$2 FOR UPDATE", [routeId,stepId]);
    if (route.rowCount !== 1 || step.rowCount !== 1 || step.rows[0].action_hash !== expectedActionHash || step.rows[0].status !== "REVIEW_READY")
      throw new Error("STALE_REVIEW_CONFLICT");
    const stage = step.rows[0].stage as ExecutionActionV1["stage"];
    if (!stage.startsWith("TEST_SETUP_") && !stage.startsWith("LEG1_") && !stage.startsWith("LEG2_") && !stage.startsWith("EXIT_"))
      throw new Error("QUOTE_REFRESH_NOT_APPLICABLE");
    const current = route.rows[0].session_snapshot as ExecutionSession;
    let next: ExecutionSession;
    if (stage.startsWith("TEST_SETUP_")) {
      next = { ...current, stage: "ROUTE_POLICY_PASS", testSetup: null, reviews: withoutReview(current,"TEST_SETUP") };
    } else if (stage.startsWith("LEG1_")) {
      next = { ...current, stage: "ROUTE_POLICY_PASS", reviews: withoutReview(current,"LEAVE_ONDO"),
        confirmations: current.confirmations.filter(value => value !== "LEAVE_ONDO") };
    } else if (stage.startsWith("LEG2_")) {
      next = { ...current, stage: "ACTUAL_USDT_MEASURED", freshLeg2: null, freshTarget: null, policyRecheck: null,
        reviews: withoutReview(current,"CHANGE_REPRESENTATION"), confirmations: current.confirmations.filter(value => value !== "CHANGE_REPRESENTATION") };
    } else {
      if (!current.recovery) throw new Error("ACTUAL_REDEEMED_NVDAB_REQUIRED");
      next = { ...current, recovery: { ...current.recovery, state: "ACTUAL_NVDAB_REDEEMED", freshExitQuote: null },
        reviews: withoutReview(current,"EXIT_TO_USDT") };
    }
    await client.query("UPDATE execution_steps SET status='SUPERSEDED',failure_reason='QUOTE_REFRESH_REQUIRED',updated_at=now() WHERE step_id=$1", [stepId]);
    await client.query("UPDATE confirmation_intents SET used_at=COALESCE(used_at,now()) WHERE route_id=$1 AND stage=$2 AND action_hash=$3",
      [routeId,stage,expectedActionHash]);
    await client.query(`UPDATE execution_routes SET session_snapshot=$3,lifecycle_state=$4,recovery_state=$5,version=version+1,updated_at=now()
      WHERE route_id=$1 AND wallet=$2`, [routeId,wallet.toLowerCase(),JSON.stringify(next),next.stage,recoveryAfterProductStop(next)]);
    return stage;
  });
}

export async function invalidateCurrentStaleQuoteReview(routeId: string, wallet: Address,
  stage: ExecutionActionV1["stage"]): Promise<void> {
  const current = await executionPool().query(`SELECT step_id,action_hash FROM execution_steps
    WHERE route_id=$1 AND stage=$2 AND status='REVIEW_READY'`, [routeId,stage]);
  if (current.rowCount !== 1) throw new Error("STALE_REVIEW_CONFLICT");
  await invalidateStaleQuoteReview(routeId,wallet,String(current.rows[0].step_id),String(current.rows[0].action_hash));
}

export async function refreshStaleQuoteReview(routeId: string, wallet: Address, stepId: string,
  expectedActionHash: string): Promise<unknown> {
  const stage = await invalidateStaleQuoteReview(routeId,wallet,stepId,expectedActionHash);
  return regenerateStaleQuoteReview(routeId,wallet,stage);
}

export async function refreshCurrentTestSetupReview(routeId: string, wallet: Address): Promise<unknown> {
  const current = await executionPool().query(`SELECT r.session_snapshot,s.step_id,s.stage,s.status,s.action_hash,s.action_v1
    FROM execution_routes r JOIN execution_steps s ON s.route_id=r.route_id
    WHERE r.route_id=$1 AND r.wallet=$2 AND s.stage LIKE 'TEST_SETUP_%'
    ORDER BY s.created_at DESC,s.attempt DESC LIMIT 1`, [routeId,wallet.toLowerCase()]);
  if (current.rowCount !== 1) throw new Error("TEST_SETUP_NOT_REVIEWABLE");
  const row = current.rows[0] as { session_snapshot: ExecutionSession; step_id: string; stage: ExecutionActionV1["stage"];
    status: string; action_hash: string; action_v1: ExecutionActionV1 };
  if (row.status !== "REVIEW_READY") throw new Error("TEST_SETUP_REFRESH_REQUIRES_MANUAL_REVIEW");
  const quote = quoteForAction(row.session_snapshot,row.action_v1);
  if (!quote) throw new Error("TEST_SETUP_NOT_REVIEWABLE");
  try {
    requireCurrentQuote(quote,row.action_v1.planIdentity);
    throw new Error("TEST_SETUP_REVIEW_STILL_FRESH");
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "QUOTE_REVIEW_EXPIRED") throw error;
  }
  return refreshStaleQuoteReview(routeId,wallet,row.step_id,row.action_hash);
}

export async function regenerateStaleQuoteReview(routeId: string, wallet: Address, stage: ExecutionActionV1["stage"]): Promise<unknown> {
  if (stage.startsWith("TEST_SETUP_")) return prepareDurableTestSetupReview(routeId,wallet);
  if (stage.startsWith("LEG1_")) return prepareInitialExecutionReview(routeId,wallet);
  if (stage.startsWith("LEG2_")) return prepareDurableLeg2Review(routeId,wallet);
  if (stage.startsWith("EXIT_")) return prepareDurableExitReview(routeId,wallet);
  throw new Error("QUOTE_REFRESH_NOT_APPLICABLE");
}
