import { recheckLeg2AfterLeg1 } from "@/domain/policy/evaluate";
import { sameAddress, USDT_ADDRESS, validateDestination, validateRepresentation } from "@/domain/routing/identity";
import type { AuthorizationReview, SimulationStatus } from "@/types/preflight";
import type { DestinationSnapshot, QuoteSnapshot, RepresentationSnapshot, RouteDecision } from "@/types/route";

export type ExecutionStage =
  | "ROUTE_PREVIEWED" | "ROUTE_POLICY_PASS" | "LEG1_AUTHORIZATION_READY" | "LEG1_PREFLIGHT_READY"
  | "LEG1_USER_CONFIRMATION_REQUIRED" | "LEG1_SUBMITTED" | "LEG1_CONFIRMED" | "ACTUAL_USDT_MEASURED"
  | "LEG2_REQUOTED" | "POLICY_RECHECKED" | "LEG2_AUTHORIZATION_READY" | "PARTIAL_ROUTE_STOPPED"
  | "LEG2_USER_CONFIRMATION_REQUIRED" | "LEG2_SUBMITTED" | "LEG2_CONFIRMED" | "ACTUAL_NVDAB_MEASURED"
  | "VENUS_REDISCOVERED" | "VENUS_AUTHORIZATION_READY" | "VENUS_PREFLIGHT_READY"
  | "VENUS_USER_CONFIRMATION_REQUIRED" | "VENUS_SUBMITTED" | "VENUS_CONFIRMED" | "VERIFIED_RECEIPT";

export type ExecutionState = {
  stage: ExecutionStage;
  preview: RouteDecision;
  fundsAsset: "NVDAon" | "USDT" | "NVDAB" | "VENUS";
  actualUsdtRaw: string | null;
  usdtMeasuredAt: string | null;
  freshLeg2: QuoteSnapshot | null;
  freshTarget: RepresentationSnapshot | null;
  policyRecheck: "PASS" | "PARTIAL_ROUTE_STOPPED" | null;
  actualNvdabRaw: string | null;
  nvdabMeasuredAt: string | null;
  rediscoveredVenus: DestinationSnapshot | null;
};

export type ExecutionEvent =
  | { kind: "CHECK_ROUTE_POLICY" }
  | { kind: "AUTHORIZE_LEG1" | "AUTHORIZE_VENUS"; authorization: AuthorizationReview }
  | { kind: "PREFLIGHT_LEG1" | "PREFLIGHT_VENUS"; simulation: SimulationStatus }
  | { kind: "REQUEST_CONFIRMATION_A" | "REQUEST_CONFIRMATION_C" }
  | { kind: "REQUEST_CONFIRMATION_B"; simulation: SimulationStatus }
  | { kind: "SUBMIT_LEG1" | "SUBMIT_LEG2" | "SUBMIT_VENUS"; userConfirmed: true; broadcastReceiptRef: string }
  | { kind: "CONFIRM_LEG1" | "CONFIRM_LEG2" | "CONFIRM_VENUS"; confirmedReceiptRef: string }
  | { kind: "MEASURE_USDT" | "MEASURE_NVDAB"; actualRaw: string; measuredAt: string }
  | { kind: "REQUOTE_LEG2"; quote: QuoteSnapshot; target: RepresentationSnapshot }
  | { kind: "RECHECK_POLICY" }
  | { kind: "CONTINUE_LEG2"; authorization: AuthorizationReview }
  | { kind: "STOP_AFTER_LEG1" }
  | { kind: "REDISCOVER_VENUS"; destination: DestinationSnapshot }
  | { kind: "VERIFY_RECEIPT"; verifiedReceiptRef: string };

const positiveRaw = /^[1-9]\d*$/;
function requireRef(value: string): void { if (!value.trim()) throw new Error("MISSING_RECEIPT_EVIDENCE"); }
function exactAuthorization(review: AuthorizationReview, token: string, amountRaw: string): boolean {
  return review.status === "BOUNDED_READY" && review.scope === "EXACT" && sameAddress(review.token, token) &&
    review.requestedAmountRaw === amountRaw && review.allowedAmountRaw === amountRaw;
}
function next(state: ExecutionState, stage: ExecutionStage, fundsAsset = state.fundsAsset): ExecutionState { return { ...state, stage, fundsAsset }; }

export function beginExecutionDesign(preview: RouteDecision): ExecutionState {
  validateRepresentation(preview.evidence.source, "source");
  validateRepresentation(preview.evidence.target, "target");
  return { stage: "ROUTE_PREVIEWED", preview, fundsAsset: "NVDAon", actualUsdtRaw: null, usdtMeasuredAt: null,
    freshLeg2: null, freshTarget: null, policyRecheck: null, actualNvdabRaw: null, nvdabMeasuredAt: null, rediscoveredVenus: null };
}

export function transitionExecution(state: ExecutionState, event: ExecutionEvent): ExecutionState {
  const at = state.stage;
  if (at === "ROUTE_PREVIEWED" && event.kind === "CHECK_ROUTE_POLICY") {
    if (state.preview.state !== "PASS") throw new Error("ROUTE_POLICY_BLOCKED");
    return next(state, "ROUTE_POLICY_PASS");
  }
  if (at === "ROUTE_POLICY_PASS" && event.kind === "AUTHORIZE_LEG1") {
    if (!exactAuthorization(event.authorization, state.preview.evidence.source.address, state.preview.evidence.sourceRaw)) throw new Error("LEG1_AUTHORIZATION_NOT_BOUNDED");
    return next(state, "LEG1_AUTHORIZATION_READY");
  }
  if (at === "LEG1_AUTHORIZATION_READY" && event.kind === "PREFLIGHT_LEG1") {
    if (event.simulation !== "PASSED") throw new Error("LEG1_PREFLIGHT_NOT_READY");
    return next(state, "LEG1_PREFLIGHT_READY");
  }
  if (at === "LEG1_PREFLIGHT_READY" && event.kind === "REQUEST_CONFIRMATION_A") return next(state, "LEG1_USER_CONFIRMATION_REQUIRED");
  if (at === "LEG1_USER_CONFIRMATION_REQUIRED" && event.kind === "SUBMIT_LEG1") { requireRef(event.broadcastReceiptRef); return next(state, "LEG1_SUBMITTED"); }
  if (at === "LEG1_SUBMITTED" && event.kind === "CONFIRM_LEG1") { requireRef(event.confirmedReceiptRef); return next(state, "LEG1_CONFIRMED"); }
  if (at === "LEG1_CONFIRMED" && event.kind === "MEASURE_USDT") {
    if (!positiveRaw.test(event.actualRaw) || !Number.isFinite(Date.parse(event.measuredAt))) throw new Error("INVALID_SETTLED_AMOUNT");
    return { ...next(state, "ACTUAL_USDT_MEASURED", "USDT"), actualUsdtRaw: event.actualRaw, usdtMeasuredAt: event.measuredAt };
  }
  if (at === "ACTUAL_USDT_MEASURED" && event.kind === "REQUOTE_LEG2") {
    validateRepresentation(event.target, "target");
    if (event.quote.leg !== 2 || !sameAddress(event.quote.from, USDT_ADDRESS) || !sameAddress(event.quote.to, event.target.address) ||
        event.quote.inputRaw !== state.actualUsdtRaw || !event.quote.quoteId || event.quote.quoteId === state.preview.evidence.leg2.quoteId ||
        !state.usdtMeasuredAt || Date.parse(event.quote.observedAt) <= Date.parse(state.usdtMeasuredAt)) throw new Error("FRESH_LEG2_QUOTE_REQUIRED");
    return { ...next(state, "LEG2_REQUOTED"), freshLeg2: event.quote, freshTarget: event.target };
  }
  if (at === "LEG2_REQUOTED" && event.kind === "RECHECK_POLICY") {
    const policyRecheck = recheckLeg2AfterLeg1({ originalSource: state.preview.evidence.source, originalSourceRaw: state.preview.evidence.sourceRaw,
      actualUsdtRaw: state.actualUsdtRaw!, refreshedTarget: state.freshTarget!, refreshedLeg2: state.freshLeg2,
      maxExposureLossBps: state.preview.maxExposureLossBps });
    return { ...next(state, "POLICY_RECHECKED"), policyRecheck };
  }
  if (at === "POLICY_RECHECKED" && event.kind === "STOP_AFTER_LEG1" && state.policyRecheck === "PARTIAL_ROUTE_STOPPED") return next(state, "PARTIAL_ROUTE_STOPPED", "USDT");
  if (at === "POLICY_RECHECKED" && event.kind === "CONTINUE_LEG2" && state.policyRecheck === "PASS") {
    if (!exactAuthorization(event.authorization, USDT_ADDRESS, state.actualUsdtRaw!)) throw new Error("LEG2_AUTHORIZATION_NOT_BOUNDED");
    // The actual approval must be rebuilt from freshLeg2.inputRaw after settlement.
    return next(state, "LEG2_AUTHORIZATION_READY");
  }
  if (at === "LEG2_AUTHORIZATION_READY" && event.kind === "REQUEST_CONFIRMATION_B") {
    if (event.simulation !== "PASSED") throw new Error("LEG2_PREFLIGHT_NOT_READY");
    return next(state, "LEG2_USER_CONFIRMATION_REQUIRED");
  }
  if (at === "LEG2_USER_CONFIRMATION_REQUIRED" && event.kind === "SUBMIT_LEG2") { requireRef(event.broadcastReceiptRef); return next(state, "LEG2_SUBMITTED"); }
  if (at === "LEG2_SUBMITTED" && event.kind === "CONFIRM_LEG2") { requireRef(event.confirmedReceiptRef); return next(state, "LEG2_CONFIRMED"); }
  if (at === "LEG2_CONFIRMED" && event.kind === "MEASURE_NVDAB") {
    if (!positiveRaw.test(event.actualRaw) || !Number.isFinite(Date.parse(event.measuredAt))) throw new Error("INVALID_SETTLED_AMOUNT");
    return { ...next(state, "ACTUAL_NVDAB_MEASURED", "NVDAB"), actualNvdabRaw: event.actualRaw, nvdabMeasuredAt: event.measuredAt };
  }
  if (at === "ACTUAL_NVDAB_MEASURED" && event.kind === "REDISCOVER_VENUS") {
    validateDestination(event.destination);
    if (!event.destination.investable || !state.nvdabMeasuredAt || Date.parse(event.destination.observedAt) <= Date.parse(state.nvdabMeasuredAt)) throw new Error("FRESH_VENUS_DISCOVERY_REQUIRED");
    return { ...next(state, "VENUS_REDISCOVERED"), rediscoveredVenus: event.destination };
  }
  if (at === "VENUS_REDISCOVERED" && event.kind === "AUTHORIZE_VENUS") {
    if (!exactAuthorization(event.authorization, state.preview.evidence.target.address, state.actualNvdabRaw!)) throw new Error("VENUS_AUTHORIZATION_NOT_BOUNDED");
    return next(state, "VENUS_AUTHORIZATION_READY");
  }
  if (at === "VENUS_AUTHORIZATION_READY" && event.kind === "PREFLIGHT_VENUS") {
    if (event.simulation !== "PASSED") throw new Error("VENUS_PREFLIGHT_NOT_READY");
    return next(state, "VENUS_PREFLIGHT_READY");
  }
  if (at === "VENUS_PREFLIGHT_READY" && event.kind === "REQUEST_CONFIRMATION_C") return next(state, "VENUS_USER_CONFIRMATION_REQUIRED");
  if (at === "VENUS_USER_CONFIRMATION_REQUIRED" && event.kind === "SUBMIT_VENUS") { requireRef(event.broadcastReceiptRef); return next(state, "VENUS_SUBMITTED"); }
  if (at === "VENUS_SUBMITTED" && event.kind === "CONFIRM_VENUS") { requireRef(event.confirmedReceiptRef); return next(state, "VENUS_CONFIRMED", "VENUS"); }
  if (at === "VENUS_CONFIRMED" && event.kind === "VERIFY_RECEIPT") { requireRef(event.verifiedReceiptRef); return next(state, "VERIFIED_RECEIPT"); }
  throw new Error("INVALID_EXECUTION_TRANSITION");
}
