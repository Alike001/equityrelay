import "server-only";
import { randomUUID } from "node:crypto";
import { createConfirmationIntent, hashSecret } from "@/domain/execution/confirmation";
import { executionActionHash, type ExecutionActionV1 } from "@/domain/execution/action";
import { sameAddress } from "@/domain/routing/identity";
import { requireStepOrder } from "@/domain/execution/step-order";
import { recordConfirmation } from "@/domain/execution/lifecycle";
import { requireActionReadiness, requireCurrentQuote } from "@/lib/execution/readiness";
import { executionPool, transaction } from "@/lib/db/pool";
import type { ExecutionSession } from "@/types/execution";

export type StoredRoute = { session: ExecutionSession; version: number; state: string; wallet: string };
export type StoredStep = { id: string; stage: ExecutionActionV1["stage"]; status: string; action: ExecutionActionV1; actionHash: string; txHash: string | null };

export async function createExecutionRoute(session: ExecutionSession): Promise<void> {
  await executionPool().query(`INSERT INTO execution_routes(route_id,wallet,chain_id,original_intent,original_source_raw,max_exposure_loss_bps,lifecycle_state,session_snapshot)
    VALUES ($1,$2,56,$3,$4,$5,$6,$7)`, [session.id, session.owner.toLowerCase(), JSON.stringify(session.intent),
    session.originalSourceRaw, session.intent.maxExposureLossBps, session.stage, JSON.stringify(session)]);
}
export async function getExecutionRoute(routeId: string, wallet: string): Promise<StoredRoute | null> {
  const found = await executionPool().query("SELECT wallet,lifecycle_state,version::text,session_snapshot FROM execution_routes WHERE route_id=$1 AND wallet=$2", [routeId, wallet.toLowerCase()]);
  const row = found.rows[0] as { wallet: string; lifecycle_state: string; version: string; session_snapshot: ExecutionSession } | undefined;
  return row ? { session: row.session_snapshot, version: Number(row.version), state: row.lifecycle_state, wallet: row.wallet } : null;
}
export async function saveExecutionRoute(routeId: string, wallet: string, expectedVersion: number, session: ExecutionSession): Promise<number> {
  if (!sameAddress(wallet, session.owner) || session.id !== routeId) throw new Error("ROUTE_WALLET_MISMATCH");
  return transaction(async client => {
    const row = await client.query("SELECT version,lifecycle_state FROM execution_routes WHERE route_id=$1 AND wallet=$2 FOR UPDATE", [routeId, wallet.toLowerCase()]);
    if (row.rowCount !== 1 || Number(row.rows[0].version) !== expectedVersion) throw new Error("ROUTE_VERSION_CONFLICT");
    const updated = await client.query(`UPDATE execution_routes SET session_snapshot=$3,lifecycle_state=$4,version=version+1,updated_at=now()
      WHERE route_id=$1 AND wallet=$2 RETURNING version`, [routeId, wallet.toLowerCase(), JSON.stringify(session), session.stage]);
    await client.query("DELETE FROM confirmation_intents WHERE route_id=$1 AND used_at IS NULL", [routeId]);
    return Number(updated.rows[0].version);
  });
}
export async function createExecutionStep(routeId: string, wallet: string, version: number, action: ExecutionActionV1, metadata: {
  quote?: unknown; authorization?: unknown; gas?: unknown;
} = {}): Promise<StoredStep> {
  if (routeId !== action.routeId || !sameAddress(wallet, action.from)) throw new Error("STEP_WALLET_MISMATCH");
  return transaction(async client => {
    const route = await client.query("SELECT version,session_snapshot FROM execution_routes WHERE route_id=$1 AND wallet=$2 FOR UPDATE", [routeId, wallet.toLowerCase()]);
    if (route.rowCount !== 1 || Number(route.rows[0].version) !== version) throw new Error("ROUTE_VERSION_CONFLICT");
    const confirmed = await client.query("SELECT stage FROM execution_steps WHERE route_id=$1 AND status='CONFIRMED'", [routeId]);
    requireStepOrder(route.rows[0].session_snapshot as ExecutionSession, action, new Set(confirmed.rows.map(row => String(row.stage))));
    const previous = await client.query("SELECT COALESCE(MAX(attempt),0)+1 AS next FROM execution_steps WHERE route_id=$1 AND stage=$2", [routeId, action.stage]);
    const id = randomUUID(), currentAction = { ...action, planRevision: randomUUID() };
    const actionHash = executionActionHash(currentAction);
    await client.query("UPDATE execution_steps SET status='SUPERSEDED',updated_at=now() WHERE route_id=$1 AND stage=$2 AND status='REVIEW_READY'", [routeId, action.stage]);
    await client.query(`INSERT INTO execution_steps(step_id,route_id,stage,action_kind,action_hash,action_v1,status,attempt,quote_metadata,bounded_authorization,recommended_gas)
      VALUES($1,$2,$3,$4,$5,$6,'REVIEW_READY',$7,$8,$9,$10)`, [id, routeId, action.stage, action.kind, actionHash, JSON.stringify(currentAction), previous.rows[0].next,
      metadata.quote ? JSON.stringify(metadata.quote) : null, metadata.authorization ? JSON.stringify(metadata.authorization) : null, metadata.gas ? JSON.stringify(metadata.gas) : null]);
    await client.query("DELETE FROM confirmation_intents WHERE route_id=$1 AND stage=$2 AND used_at IS NULL", [routeId, action.stage]);
    await client.query("UPDATE execution_routes SET version=version+1,updated_at=now() WHERE route_id=$1", [routeId]);
    return { id, stage: action.stage, status: "REVIEW_READY", action: currentAction, actionHash, txHash: null };
  });
}
export async function issueConfirmation(routeId: string, wallet: string, stage: ExecutionActionV1["stage"], idempotencyKey: string): Promise<{ token: string; step: StoredStep }> {
  // External reads precede the DB lock; the locked transition rechecks the route version and action hash.
  const candidate = await executionPool().query(`SELECT r.session_snapshot,r.version,s.action_v1,s.action_hash,s.recommended_gas FROM execution_routes r
    JOIN execution_steps s ON s.route_id=r.route_id WHERE r.route_id=$1 AND r.wallet=$2 AND s.stage=$3 AND s.status='REVIEW_READY'`,
    [routeId,wallet.toLowerCase(),stage]);
  if (candidate.rowCount !== 1) throw new Error("STEP_NOT_REVIEW_READY");
  const session = candidate.rows[0].session_snapshot as ExecutionSession;
  const action = candidate.rows[0].action_v1 as ExecutionActionV1;
  if (action.kind === "SWAP") requireCurrentQuote(stage.startsWith("LEG1") ? session.initialQuote : session.freshLeg2, action.planIdentity);
  if (action.kind === "DEPOSIT" && (!session.venus?.investable || action.planIdentity !== session.venus.investmentId)) throw new Error("VENUS_REDISCOVERY_REQUIRED");
  const gas = candidate.rows[0].recommended_gas as { gasLimit?: string } | null;
  await requireActionReadiness(action, gas?.gasLimit ?? "");
  return transaction(async client => {
    const route = await client.query("SELECT version,lifecycle_state FROM execution_routes WHERE route_id=$1 AND wallet=$2 FOR UPDATE", [routeId, wallet.toLowerCase()]);
    if (route.rowCount !== 1 || !Number.isSafeInteger(Number(route.rows[0].version))) throw new Error("ROUTE_NOT_FOUND");
    if (Number(route.rows[0].version) !== Number(candidate.rows[0].version)) throw new Error("ROUTE_VERSION_CONFLICT");
    const step = await client.query("SELECT step_id,action_v1,action_hash,status FROM execution_steps WHERE route_id=$1 AND stage=$2 AND status='REVIEW_READY' FOR UPDATE", [routeId, stage]);
    if (step.rowCount !== 1) throw new Error("STEP_NOT_REVIEW_READY");
    const action = step.rows[0].action_v1 as ExecutionActionV1;
    if (!sameAddress(action.from, wallet) || action.routeId !== routeId || action.stage !== stage || executionActionHash(action) !== step.rows[0].action_hash ||
        step.rows[0].action_hash !== candidate.rows[0].action_hash) throw new Error("ACTION_HASH_MISMATCH");
    const current = await client.query("SELECT session_snapshot FROM execution_routes WHERE route_id=$1", [routeId]);
    const session = current.rows[0].session_snapshot as ExecutionSession;
    const confirmed = await client.query("SELECT stage FROM execution_steps WHERE route_id=$1 AND status='CONFIRMED'", [routeId]);
    requireStepOrder(session, action, new Set(confirmed.rows.map(row => String(row.stage))));
    const { token, intent } = createConfirmationIntent({ routeId, wallet: wallet.toLowerCase(), stage,
      actionHash: step.rows[0].action_hash, routeVersion: Number(route.rows[0].version), idempotencyKey,
      expiresAt: new Date(Date.now() + 2 * 60_000).toISOString() });
    await client.query(`INSERT INTO confirmation_intents(intent_id,token_hash,route_id,wallet,stage,action_hash,route_version,idempotency_key,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [intent.id,intent.tokenHash,routeId,wallet.toLowerCase(),stage,intent.actionHash,intent.routeVersion,idempotencyKey,intent.expiresAt]);
    return { token, step: { id: step.rows[0].step_id, stage, status: "REVIEW_READY", action, actionHash: intent.actionHash, txHash: null } };
  });
}
export async function reserveConfirmation(input: { routeId: string; wallet: string; stage: ExecutionActionV1["stage"]; token: string; actionHash: string; routeVersion: number }): Promise<void> {
  await transaction(async client => {
    const route = await client.query("SELECT version,session_snapshot FROM execution_routes WHERE route_id=$1 AND wallet=$2 FOR UPDATE", [input.routeId,input.wallet.toLowerCase()]);
    if (route.rowCount !== 1 || Number(route.rows[0].version) !== input.routeVersion) throw new Error("ROUTE_VERSION_CONFLICT");
    const step = await client.query("SELECT step_id,action_v1 FROM execution_steps WHERE route_id=$1 AND stage=$2 AND status='REVIEW_READY' FOR UPDATE", [input.routeId,input.stage]);
    if (step.rowCount !== 1 || executionActionHash(step.rows[0].action_v1 as ExecutionActionV1) !== input.actionHash) throw new Error("ACTION_HASH_MISMATCH");
    const session = route.rows[0].session_snapshot as ExecutionSession;
    const confirmed = await client.query("SELECT stage FROM execution_steps WHERE route_id=$1 AND status='CONFIRMED'", [input.routeId]);
    requireStepOrder(session, step.rows[0].action_v1 as ExecutionActionV1, new Set(confirmed.rows.map(row => String(row.stage))));
    const consumed = await client.query(`UPDATE confirmation_intents SET used_at=now() WHERE token_hash=$1 AND route_id=$2 AND wallet=$3
      AND stage=$4 AND action_hash=$5 AND route_version=$6 AND used_at IS NULL AND expires_at>now() RETURNING intent_id`,
      [hashSecret(input.token),input.routeId,input.wallet.toLowerCase(),input.stage,input.actionHash,input.routeVersion]);
    if (consumed.rowCount !== 1) throw new Error("CONFIRMATION_EXPIRED_OR_USED");
    await client.query("UPDATE execution_steps SET status='AWAITING_WALLET_TX',reserved_at=now(),updated_at=now() WHERE step_id=$1", [step.rows[0].step_id]);
    const boundary = input.stage.startsWith("LEG1") ? "LEAVE_ONDO" : input.stage.startsWith("LEG2") ? "CHANGE_REPRESENTATION" : "SUPPLY_TO_VENUS";
    const next = session.confirmations.includes(boundary) ? session : recordConfirmation(session, boundary);
    await client.query("UPDATE execution_routes SET session_snapshot=$2,version=version+1,updated_at=now() WHERE route_id=$1", [input.routeId,JSON.stringify(next)]);
  });
}
export async function abandonReservation(routeId: string, wallet: string, stage: ExecutionActionV1["stage"], reason: "USER_REJECTED" | "WALLET_PROMPT_EXPIRED" | "RESERVATION_EXPIRED"): Promise<void> {
  // Internal-only Phase 3B primitive. Do not expose a browser rejection claim as proof
  // of no broadcast; lost-hash recovery needs a separate chain/provider review.
  await transaction(async client => {
    const route = await client.query("SELECT version,session_snapshot FROM execution_routes WHERE route_id=$1 AND wallet=$2 FOR UPDATE", [routeId,wallet.toLowerCase()]);
    if (route.rowCount !== 1) throw new Error("ROUTE_NOT_FOUND");
    const changed = await client.query(`UPDATE execution_steps SET status=$3,failure_reason=$3,updated_at=now()
      WHERE route_id=$1 AND stage=$2 AND status='AWAITING_WALLET_TX' AND tx_hash IS NULL
      AND ($3='USER_REJECTED' OR reserved_at < now() - interval '2 minutes') RETURNING step_id`, [routeId,stage,reason]);
    if (changed.rowCount !== 1) throw new Error("RESERVATION_NOT_ABANDONABLE");
    const boundary = stage.startsWith("LEG1") ? "LEAVE_ONDO" : stage.startsWith("LEG2") ? "CHANGE_REPRESENTATION" : "SUPPLY_TO_VENUS";
    const confirmed = await client.query("SELECT 1 FROM execution_steps WHERE route_id=$1 AND stage LIKE $2 AND status='CONFIRMED' LIMIT 1", [routeId, stage.startsWith("LEG1") ? "LEG1_%" : stage.startsWith("LEG2") ? "LEG2_%" : "VENUS_%"]);
    const session = route.rows[0].session_snapshot as ExecutionSession;
    const next = confirmed.rowCount ? session : { ...session, confirmations: session.confirmations.filter(value => value !== boundary) };
    await client.query("UPDATE execution_routes SET session_snapshot=$2,version=version+1,updated_at=now() WHERE route_id=$1", [routeId,JSON.stringify(next)]);
  });
}
