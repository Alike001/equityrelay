import "server-only";
import type { ExecutionActionV1 } from "@/domain/execution/action";
import { recoveryAfterProductStop } from "@/domain/execution/recovery";
import { transaction } from "@/lib/db/pool";
import { prepareInitialExecutionReview } from "@/lib/execution/initial-review";
import { prepareDurableLeg2Review } from "@/lib/execution/post-settlement";
import { prepareDurableExitReview } from "@/lib/execution/recovery-review";
import { prepareDurableTestSetupReview } from "@/lib/execution/test-setup-review";
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

export async function regenerateStaleQuoteReview(routeId: string, wallet: Address, stage: ExecutionActionV1["stage"]): Promise<unknown> {
  if (stage.startsWith("TEST_SETUP_")) return prepareDurableTestSetupReview(routeId,wallet);
  if (stage.startsWith("LEG1_")) return prepareInitialExecutionReview(routeId,wallet);
  if (stage.startsWith("LEG2_")) return prepareDurableLeg2Review(routeId,wallet);
  if (stage.startsWith("EXIT_")) return prepareDurableExitReview(routeId,wallet);
  throw new Error("QUOTE_REFRESH_NOT_APPLICABLE");
}
