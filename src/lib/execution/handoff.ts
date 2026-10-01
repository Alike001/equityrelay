import "server-only";
import { executionActionHash, type ExecutionActionV1 } from "@/domain/execution/action";
import { requireStepOrder } from "@/domain/execution/step-order";
import { sameAddress } from "@/domain/routing/identity";
import { hashSecret } from "@/domain/execution/confirmation";
import { executionPool } from "@/lib/db/pool";
import { quoteForAction, requireActionReadiness, requireCurrentQuote } from "@/lib/execution/readiness";
import { reserveConfirmation } from "@/lib/execution/repository";
import { discoverVenusInvestment } from "@/lib/binance/defi";
import type { ExecutionSession } from "@/types/execution";
import { assertExecutionVerifierValidated } from "@/domain/equities/registry";

export type WalletTransactionRequest = {
  from: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value: `0x${string}`;
  chainId: "0x38";
};

function quantity(value: string): `0x${string}` { return `0x${BigInt(value).toString(16)}`; }

export async function deliverWalletAction(input: { routeId: string; stepId: string; wallet: string; stage: ExecutionActionV1["stage"];
  token: string; actionHash: string; routeVersion: number }): Promise<{ transaction: WalletTransactionRequest; display: {
    stage: ExecutionActionV1["stage"]; kind: ExecutionActionV1["kind"]; tokenIn: string; tokenOut: string | null;
    amountInRaw: string; approvalSpender: string | null; approvalAmountRaw: string | null; actionHash: string } }> {
  const found = await executionPool().query(`SELECT r.session_snapshot,r.version,s.action_v1,s.action_hash,s.status,s.tx_hash,s.recommended_gas,
      i.used_at,i.expires_at
    FROM execution_routes r JOIN execution_steps s ON s.route_id=r.route_id
    JOIN confirmation_intents i ON i.route_id=r.route_id AND i.stage=s.stage AND i.action_hash=s.action_hash
    WHERE r.route_id=$1 AND r.wallet=$2 AND s.step_id=$3 AND i.token_hash=$4`,
    [input.routeId,input.wallet.toLowerCase(),input.stepId,hashSecret(input.token)]);
  if (found.rowCount !== 1) throw new Error("ACTION_DELIVERY_NOT_FOUND");
  const row = found.rows[0] as { session_snapshot: ExecutionSession; version: string; action_v1: ExecutionActionV1; action_hash: string;
    status: string; tx_hash: string | null; recommended_gas: { gasLimit?: string } | null; used_at: Date | null; expires_at: Date };
  const action = row.action_v1;
  assertExecutionVerifierValidated(row.session_snapshot.intent.underlying);
  if (!sameAddress(action.from,input.wallet) || action.routeId !== input.routeId || action.stage !== input.stage ||
      row.action_hash !== input.actionHash || executionActionHash(action) !== input.actionHash || Number(row.version) !== input.routeVersion)
    throw new Error("ACTION_DELIVERY_BINDING_MISMATCH");
  if (row.status !== "REVIEW_READY" || row.tx_hash || row.used_at) throw new Error("ACTION_ALREADY_RESERVED_OR_SUBMITTED");
  const quote = quoteForAction(row.session_snapshot, action);
  if (row.expires_at.getTime() <= Date.now()) throw new Error(quote ? "QUOTE_REFRESH_REQUIRED" : "CONFIRMATION_EXPIRED_OR_USED");
  if (quote) {
    try { requireCurrentQuote(quote, action.planIdentity); }
    catch { throw new Error("QUOTE_REFRESH_REQUIRED"); }
  }
  if (action.kind === "DEPOSIT") {
    const current = await discoverVenusInvestment(row.session_snapshot.intent.underlying);
    if (!row.session_snapshot.venus?.investable || action.planIdentity !== row.session_snapshot.venus.investmentId ||
        !current?.investable || current.investmentId !== action.planIdentity)
      throw new Error("DESTINATION_UNAVAILABLE");
  }
  const confirmed = await executionPool().query("SELECT stage FROM execution_steps WHERE route_id=$1 AND status='CONFIRMED'", [input.routeId]);
  requireStepOrder(row.session_snapshot,action,new Set(confirmed.rows.map(value => String(value.stage))));
  await requireActionReadiness(action,row.recommended_gas?.gasLimit ?? "");
  await reserveConfirmation(input);
  return { transaction: { from: action.from, to: action.to, data: action.data, value: quantity(action.valueWei), chainId: "0x38" },
    display: { stage: action.stage, kind: action.kind, tokenIn: action.tokenIn, tokenOut: action.tokenOut,
      amountInRaw: action.amountInRaw, approvalSpender: action.approvalSpender, approvalAmountRaw: action.approvalAmountRaw,
      actionHash: input.actionHash } };
}
