import "server-only";
import { executionActionV1 } from "@/domain/execution/action";
import { prepareReview } from "@/domain/execution/lifecycle";
import { createServerReview } from "./review";
import { getExecutionRoute, persistPreparedReview, saveExecutionRoute } from "./repository";
import { prepareLeg2FromMeasured, prepareVenusFromMeasured } from "./prepare";
import { simulateEvmTransaction } from "@/lib/binance/simulation";
import type { Address } from "@/types/route";
import { executionPool } from "@/lib/db/pool";
import type { SettlementEvidence } from "@/types/execution";

async function requireStoredSettlement(routeId: string, stage: "LEG1_SWAP" | "LEG2_SWAP", settlement: SettlementEvidence): Promise<void> {
  const found = await executionPool().query(`SELECT e.tx_hash,e.block_number::text,e.amount_out_raw::text,e.evidence_source
    FROM settlement_evidence e JOIN execution_steps s ON s.route_id=e.route_id AND s.stage=e.stage AND s.tx_hash=e.tx_hash
    WHERE e.route_id=$1 AND e.stage=$2 AND s.status='CONFIRMED'`, [routeId,stage]);
  const row = found.rows[0] as { tx_hash: string; block_number: string; amount_out_raw: string; evidence_source: string } | undefined;
  if (found.rowCount !== 1 || !row || row.evidence_source !== "BSC_CANONICAL_RPC" ||
      row.tx_hash.toLowerCase() !== settlement.transactionHash.toLowerCase() || row.block_number !== settlement.blockNumber ||
      row.amount_out_raw !== settlement.actualAmountOutRaw) throw new Error("CANONICAL_SETTLEMENT_REQUIRED");
}

export async function prepareDurableLeg2Review(routeId: string, wallet: Address) {
  const stored = await getExecutionRoute(routeId, wallet);
  if (!stored || stored.state !== "ACTUAL_USDT_MEASURED" || !stored.session.leg1Settlement) throw new Error("ACTUAL_USDT_REQUIRED");
  await requireStoredSettlement(routeId, "LEG1_SWAP", stored.session.leg1Settlement);
  const { session, build } = await prepareLeg2FromMeasured(stored.session);
  if (session.stage === "PARTIAL_ROUTE_STOPPED") {
    await saveExecutionRoute(routeId, wallet, stored.version, session);
    return { state: "PARTIAL_ROUTE_STOPPED" as const, amountRemainingRaw: session.leg1Settlement!.actualAmountOutRaw };
  }
  if (!build?.evmTx || !session.freshLeg2?.quoteId || !session.freshTarget || !session.leg1Settlement) throw new Error("FRESH_LEG2_BUILD_UNAVAILABLE");
  const swap = build.actions.find(x => x.kind === "SWAP"), approval = build.actions.find(x => x.kind === "APPROVAL");
  if (!swap) throw new Error("FRESH_LEG2_BUILD_UNAVAILABLE");
  const simulation = await simulateEvmTransaction(build.evmTx);
  const review = await createServerReview({ boundary: "CHANGE_REPRESENTATION", owner: wallet,
    action: { ...swap, simulation }, approval: approval?.authorization ?? null, quote: session.freshLeg2, destination: null });
  const reviewed = prepareReview(session, review);
  const nextAction = !review.allowanceSufficient && approval ? approval : { ...swap, simulation };
  const stage = nextAction.kind === "APPROVAL" ? "LEG2_APPROVAL" : "LEG2_SWAP";
  const step = await persistPreparedReview(routeId, wallet, stored.version, reviewed,
    executionActionV1({ routeId, stage, action: nextAction, planIdentity: session.freshLeg2.quoteId }),
    { quote: { quoteId: session.freshLeg2.quoteId, observedAt: session.freshLeg2.observedAt,
      expiresAt: session.freshLeg2.expiresAt, inputRaw: session.leg1Settlement.actualAmountOutRaw },
      authorization: nextAction.authorization, gas: { gasLimit: nextAction.gasLimit } });
  return { state: "LEG2_REVIEW" as const, stepId: step.id, stage, amountInRaw: session.leg1Settlement.actualAmountOutRaw };
}

export async function prepareDurableVenusReview(routeId: string, wallet: Address) {
  const stored = await getExecutionRoute(routeId, wallet);
  if (!stored || stored.state !== "ACTUAL_NVDAB_MEASURED" || !stored.session.leg2Settlement)
    throw new Error("ACTUAL_NVDAB_REQUIRED");
  await requireStoredSettlement(routeId, "LEG2_SWAP", stored.session.leg2Settlement);
  const { session, deposit } = await prepareVenusFromMeasured(stored.session);
  const action = deposit.actions.find(x => x.kind === "DEPOSIT"), approval = deposit.actions.find(x => x.kind === "APPROVAL");
  if (!action || !session.venus || !session.leg2Settlement) throw new Error("VENUS_BOUNDED_BUILD_REQUIRED");
  const review = await createServerReview({ boundary: "SUPPLY_TO_VENUS", owner: wallet,
    action, approval: approval?.authorization ?? null, quote: null, destination: session.venus });
  const reviewed = prepareReview(session, review);
  const nextAction = !review.allowanceSufficient && approval ? approval : action;
  const stage = nextAction.kind === "APPROVAL" ? "VENUS_APPROVAL" : "VENUS_DEPOSIT";
  const step = await persistPreparedReview(routeId, wallet, stored.version, reviewed,
    executionActionV1({ routeId, stage, action: nextAction, planIdentity: session.venus.investmentId }),
    { authorization: nextAction.authorization, gas: { gasLimit: nextAction.gasLimit } });
  return { state: "VENUS_REVIEW" as const, stepId: step.id, stage, amountInRaw: session.leg2Settlement.actualAmountOutRaw };
}
