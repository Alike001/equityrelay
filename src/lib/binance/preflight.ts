import "server-only";
import Decimal from "decimal.js";
import { normalizedShares } from "@/domain/exposure/decimal";
import { derivePerLegSlippagePercent, isWalletStateFailure } from "@/domain/preflight/validate";
import type { BrowserIntent, QuoteSnapshot, RouteDecision } from "@/types/route";
import type { PreflightResult, PreflightStage, RoutePreflight } from "@/types/preflight";
import { BinanceApiError } from "./client";
import { buildPreview } from "./preview";
import { buildSwapTransaction, type SwapBuildPlan } from "./swap-build";
import { simulateEvmTransaction } from "./simulation";
import { buildVenusDeposit } from "./defi-transaction";

function stageUnavailable(label: string, indicative: boolean, error: unknown): PreflightStage {
  const reason = error instanceof BinanceApiError ? `${error.businessCode}: ${error.message}` : error instanceof Error ? error.message : "Build response could not be validated.";
  return { label, indicative, buildStatus: "UNAVAILABLE", actions: [], simulationStatus: isWalletStateFailure(reason) ? "BLOCKED_BY_WALLET_STATE" : "UNAVAILABLE", simulationPrerequisite: indicative ? "INDICATIVE_AFTER_LEG1" : "SIMULATABLE_NOW", authorizationStatus: /(?:APPROVAL|AUTHORIZATION)/.test(reason) ? "INVALID_APPROVAL" : "UNAVAILABLE", rejectedAuthorization: null, reason, previewDetails: null };
}

async function swapStage(quote: QuoteSnapshot, owner: BrowserIntent["takerAddress"], label: string, indicative: boolean, slippagePercent: string): Promise<{ stage: PreflightStage; plan: SwapBuildPlan | null; error: unknown | null }> {
  try {
    const plan = await buildSwapTransaction(quote, owner, slippagePercent);
    const simulation = plan.evmTx ? await simulateEvmTransaction(plan.evmTx) : plan.actions.at(-1)!.simulation;
    const actions = await Promise.all(plan.actions.map(async action => action.kind === "APPROVAL" && action.to && action.rawCalldata && action.valueWei !== null
      ? { ...action, simulation: await simulateEvmTransaction({ from: action.from, to: action.to, value: action.valueWei, data: action.rawCalldata }) }
      : action.kind === "SWAP" ? { ...action, simulation } : action));
    const approval = actions.find(action => action.kind === "APPROVAL");
    const simulationPrerequisite = indicative ? "INDICATIVE_AFTER_LEG1" : simulation.failReason && /allowance/i.test(simulation.failReason) && approval ? "REQUIRES_PRIOR_APPROVAL_STATE" : simulation.failReason && /balance/i.test(simulation.failReason) ? "REQUIRES_CURRENT_BALANCE" : "SIMULATABLE_NOW";
    return { stage: { label, indicative, buildStatus: "READY", actions: actions.map(action => action.kind === "SWAP" ? { ...action, simulationPrerequisite } : action), simulationStatus: simulation.status, simulationPrerequisite, authorizationStatus: approval ? "BOUNDED_READY" : "REQUIRES_ONCHAIN_ALLOWANCE", rejectedAuthorization: null, reason: simulation.failReason, previewDetails: null }, plan, error: null };
  } catch (error) { return { stage: stageUnavailable(label, indicative, error), plan: null, error }; }
}

function quoteRefreshNeeded(error: unknown): boolean {
  return error instanceof BinanceApiError && error.businessCode === "40401" ||
    error instanceof Error && /^(?:MISSING_QUOTE_ID|QUOTE_EXPIRED|QUOTE_TOO_OLD_FOR_BUILD|BUILD_OUTPUT_CHANGED_REQUOTE_REQUIRED)$/.test(error.message);
}

function evaluatePreflightSafety(preview: RouteDecision, leg1: PreflightStage, leg2: PreflightStage, venus: PreflightStage, leg1Plan: SwapBuildPlan | null, leg2Plan: SwapBuildPlan | null): Pick<RoutePreflight, "overallPreflightState" | "safetyWarnings"> {
  const warnings: string[] = ["Leg 2 and the Venus deposit are indicative. Execution must re-quote leg 2 after actual USDT arrives and re-check the exposure policy."];
  let unsafeBuild = false;
  if (leg1Plan?.minReceiveRaw && leg2Plan?.minReceiveRaw) {
    const leg1Factor = new Decimal(leg1Plan.minReceiveRaw).div(leg1Plan.quoteOutputRaw);
    const minimumShares = normalizedShares(leg2Plan.minReceiveRaw, preview.evidence.target.decimals, preview.evidence.target.tokenToShareRatio).mul(leg1Factor);
    const originalShares = normalizedShares(preview.evidence.sourceRaw, preview.evidence.source.decimals, preview.evidence.source.tokenToShareRatio);
    const minimumLoss = new Decimal(1).minus(minimumShares.div(originalShares));
    if (minimumLoss.gt(new Decimal(preview.maxExposureLossBps).div(10000))) {
      warnings.push("The combined built minimum receives would exceed your maximum exposure reduction. Do not continue with this plan.");
      unsafeBuild = true;
    }
  } else warnings.push("An EVM minimum receive was unavailable for one or both swap legs. The final exposure floor cannot be confirmed here.");
  if (venus.rejectedAuthorization) warnings.push("Binance requested a broad Venus approval. EquityRelay rejected it and prepared an unsigned exact-amount replacement. Nothing was submitted.");
  if (unsafeBuild) return { overallPreflightState: "BLOCKED", safetyWarnings: warnings };
  const stages = [leg1, leg2, venus];
  const approvalSimulations = stages.flatMap(stage => stage.actions.filter(action => action.kind === "APPROVAL").map(action => action.simulation.status));
  if (stages.some(x => x.buildStatus === "UNAVAILABLE" || x.simulationStatus === "UNAVAILABLE")) return { overallPreflightState: "UNAVAILABLE", safetyWarnings: warnings };
  if (stages.some(x => x.simulationStatus === "FAILED") || approvalSimulations.includes("FAILED")) return { overallPreflightState: "BLOCKED", safetyWarnings: warnings };
  if (approvalSimulations.includes("UNAVAILABLE")) return { overallPreflightState: "UNAVAILABLE", safetyWarnings: warnings };
  if (stages.some(x => x.simulationStatus === "BLOCKED_BY_WALLET_STATE") || approvalSimulations.includes("BLOCKED_BY_WALLET_STATE")) return { overallPreflightState: "WALLET_STATE_BLOCKED", safetyWarnings: warnings };
  return { overallPreflightState: "READY_TO_REVIEW", safetyWarnings: warnings };
}

export async function buildRoutePreflight(intent: BrowserIntent): Promise<PreflightResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    // Reacquire all live Phase 1 evidence. Browser quote IDs, contracts and ratios are never accepted.
    const preview = await buildPreview(intent);
    if (preview.kind !== "decision" || preview.state !== "PASS") return {
      kind: "refusal", routePolicy: preview.state === "BLOCKED" ? "BLOCKED" : "UNAVAILABLE",
      overallPreflightState: preview.state === "BLOCKED" ? "BLOCKED" : "UNAVAILABLE",
      reason: preview.kind === "decision" ? preview.reasons.join(" · ") : preview.message,
    };
    const slippagePercent = derivePerLegSlippagePercent(preview);
    const leg1 = await swapStage(preview.evidence.leg1, intent.takerAddress, "Leave Ondo", false, slippagePercent);
    const leg2 = await swapStage(preview.evidence.leg2, intent.takerAddress, "Change representation", true, slippagePercent);
    if (attempt === 0 && (quoteRefreshNeeded(leg1.error) || quoteRefreshNeeded(leg2.error))) continue;
    let venus: PreflightStage;
    try {
      venus = await buildVenusDeposit(intent.takerAddress, preview.evidence.destination, preview.evidence.target, preview.evidence.leg2.outputRaw);
      if (venus.buildStatus === "READY") venus = { ...venus, actions: await Promise.all(venus.actions.map(async action => action.kind === "APPROVAL" && action.to && action.rawCalldata && action.valueWei !== null
        ? { ...action, simulation: await simulateEvmTransaction({ from: action.from, to: action.to, value: action.valueWei, data: action.rawCalldata }) } : action)) };
    } catch (error) { venus = stageUnavailable("Prepare Venus", true, error); }
    const safety = evaluatePreflightSafety(preview, leg1.stage, leg2.stage, venus, leg1.plan, leg2.plan);
    return {
      kind: "preflight", routePolicy: "PASS",
      routePreview: { amount: preview.amount, maxExposureLossBps: preview.maxExposureLossBps, sourceShares: preview.sourceShares, targetShares: preview.targetShares, retentionPercent: preview.retentionPercent, exposureLossPercent: preview.exposureLossPercent, observedAt: preview.observedAt },
      leg1: leg1.stage, leg2Indicative: leg2.stage, venusDepositIndicative: venus,
      ...safety,
      authorizationSafety: [leg1.stage, leg2.stage, venus].some(stage => stage.authorizationStatus === "INVALID_APPROVAL") ? "INVALID_APPROVAL" :
        [leg1.stage, leg2.stage, venus].some(stage => stage.authorizationStatus === "UNAVAILABLE") ? "UNAVAILABLE" :
        [leg1.stage, leg2.stage, venus].some(stage => stage.authorizationStatus === "REQUIRES_ONCHAIN_ALLOWANCE") ? "REQUIRES_ONCHAIN_ALLOWANCE" : "BOUNDED_READY",
      executionReadiness: "NOT_READY", observedAt: new Date().toISOString(),
    };
  }
  return { kind: "refusal", routePolicy: "UNAVAILABLE", overallPreflightState: "UNAVAILABLE", reason: "Quotes expired during preflight. Build a fresh route." };
}
