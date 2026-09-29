import "server-only";
import { beginExecutionSession, prepareReview } from "@/domain/execution/lifecycle";
import { executionActionV1 } from "@/domain/execution/action";
import { derivePerLegSlippagePercent } from "@/domain/preflight/validate";
import { buildPreview } from "@/lib/binance/preview";
import { buildSwapTransaction } from "@/lib/binance/swap-build";
import { simulateEvmTransaction } from "@/lib/binance/simulation";
import { createServerReview } from "@/lib/execution/review";
import { createExecutionStep, getExecutionRoute, saveExecutionRoute } from "@/lib/execution/repository";
import type { Address } from "@/types/route";

export async function prepareInitialExecutionReview(routeId: string, wallet: Address) {
  const stored = await getExecutionRoute(routeId, wallet);
  if (!stored || !["ROUTE_POLICY_PASS", "LEG1_REVIEW"].includes(stored.state)) throw new Error("ROUTE_NOT_REVIEWABLE");
  // Authenticated wallet is authoritative. Reacquire RWA data and quotes instead of using browser evidence.
  const preview = await buildPreview({ ...stored.session.intent, takerAddress: wallet });
  if (preview.kind !== "decision" || preview.state !== "PASS") throw new Error("FRESH_ROUTE_POLICY_PASS_REQUIRED");
  const quote = preview.evidence.leg1;
  if (!quote.quoteId) throw new Error("FRESH_QUOTE_REQUIRED");
  const build = await buildSwapTransaction(quote, wallet, derivePerLegSlippagePercent(preview));
  if (!build.evmTx) throw new Error("RFQ_EXECUTION_REVIEW_UNAVAILABLE");
  const swap = build.actions.find(action => action.kind === "SWAP");
  if (!swap) throw new Error("SWAP_ACTION_UNAVAILABLE");
  const approval = build.actions.find(action => action.kind === "APPROVAL");
  const simulation = await simulateEvmTransaction(build.evmTx);
  const review = await createServerReview({ boundary: "LEAVE_ONDO", owner: wallet,
    action: { ...swap, simulation }, approval: approval?.authorization ?? null, quote, destination: null });
  const refreshed = beginExecutionSession(routeId, wallet, preview);
  const reviewed = prepareReview(refreshed, review);
  const version = await saveExecutionRoute(routeId, wallet, stored.version, reviewed);
  const nextAction = !review.allowanceSufficient && approval ? approval : { ...swap, simulation };
  const stage = nextAction.kind === "APPROVAL" ? "LEG1_APPROVAL" : "LEG1_SWAP";
  const step = await createExecutionStep(routeId, wallet, version,
    executionActionV1({ routeId, stage, action: nextAction, planIdentity: quote.quoteId }),
    { quote: { quoteId: quote.quoteId, observedAt: quote.observedAt, expiresAt: quote.expiresAt },
      authorization: nextAction.authorization,
      gas: { gasLimit: nextAction.gasLimit, gasPrice: nextAction.gasPrice,
        maxFeePerGas: nextAction.maxFeePerGas, maxPriorityFeePerGas: nextAction.maxPriorityFeePerGas } });
  return { routeId, state: reviewed.stage, stepId: step.id, stage: step.stage, actionKind: step.action.kind,
    actionHash: step.actionHash, amountInRaw: step.action.amountInRaw,
    amountHuman: nextAction.amountInHuman, tokenLabel: nextAction.tokenInLabel,
    minimumReceiveHuman: swap.minAmountOutHuman, targetReturnedByBinance: swap.to,
    simulationStatus: simulation.status, executionArmed: false };
}
