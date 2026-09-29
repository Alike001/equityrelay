import Decimal from "decimal.js";
import { decimalText, normalizedShares } from "@/domain/exposure/decimal";
import { sameAddress, USDT_ADDRESS, validateDestination, validateRepresentation } from "@/domain/routing/identity";
import type { BrowserIntent, QuoteSnapshot, ReasonCode, RepresentationSnapshot, RouteDecision, RouteEvidence } from "@/types/route";

const ORDER: ReasonCode[] = ["INVALID_EVIDENCE", "UNAVAILABLE_API", "BLOCK_SOURCE_STATUS", "BLOCK_TARGET_STATUS", "BLOCK_DESTINATION_NOT_INVESTABLE", "BLOCK_NO_LEG1_QUOTE", "BLOCK_NO_LEG2_QUOTE", "BLOCK_EXPOSURE_POLICY", "PARTIAL_ROUTE_STOPPED", "PASS_ROUTE_READY"];
export function orderedReasons(reasons: ReasonCode[]): ReasonCode[] { return [...new Set(reasons)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)); }

function validateQuote(quote: QuoteSnapshot, leg: 1 | 2, from: string, to: string, inputRaw: string): void {
  if (quote.leg !== leg || !sameAddress(quote.from, from) || !sameAddress(quote.to, to) || quote.inputRaw !== inputRaw ||
      !/^[1-9]\d*$/.test(quote.outputRaw) || !Number.isFinite(Date.parse(quote.observedAt)) ||
      (quote.expiresAt !== null && (!Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.now()))) {
    throw new Error("INVALID_EVIDENCE");
  }
}

export function evaluateRoute(intent: BrowserIntent, evidence: RouteEvidence): RouteDecision {
  validateRepresentation(evidence.source, "source");
  validateRepresentation(evidence.target, "target");
  validateDestination(evidence.destination);
  if (!Number.isInteger(intent.maxExposureLossBps) || intent.maxExposureLossBps < 0 || intent.maxExposureLossBps > 10000) throw new Error("INVALID_POLICY");
  validateQuote(evidence.leg1, 1, evidence.source.address, USDT_ADDRESS, evidence.sourceRaw);
  validateQuote(evidence.leg2, 2, USDT_ADDRESS, evidence.target.address, evidence.leg1.outputRaw);
  const source = normalizedShares(evidence.sourceRaw, evidence.source.decimals, evidence.source.tokenToShareRatio);
  const target = normalizedShares(evidence.leg2.outputRaw, evidence.target.decimals, evidence.target.tokenToShareRatio);
  const retention = target.div(source);
  const loss = new Decimal(1).minus(retention);
  const threshold = new Decimal(intent.maxExposureLossBps).div(10000);
  const reasons: ReasonCode[] = [];
  if (!evidence.source.open) reasons.push("BLOCK_SOURCE_STATUS");
  if (!evidence.target.open) reasons.push("BLOCK_TARGET_STATUS");
  if (!evidence.destination.investable) reasons.push("BLOCK_DESTINATION_NOT_INVESTABLE");
  if (loss.gt(threshold)) reasons.push("BLOCK_EXPOSURE_POLICY");
  const state = reasons.length ? "BLOCKED" : "PASS";
  if (!reasons.length) reasons.push("PASS_ROUTE_READY");
  const expiries = [evidence.leg1.expiresAt, evidence.leg2.expiresAt].filter((x): x is string => x !== null);
  return {
    kind: "decision", state, reasons: orderedReasons(reasons), amount: intent.amount,
    maxExposureLossBps: intent.maxExposureLossBps,
    sourceShares: decimalText(source), targetShares: decimalText(target),
    retentionPercent: decimalText(retention.mul(100)), exposureLossPercent: decimalText(loss.mul(100)),
    observedAt: evidence.leg2.observedAt,
    expiresAt: expiries.length ? expiries.sort()[0] : null,
    evidence,
  };
}

export type Leg2RecheckInput = {
  originalSource: RepresentationSnapshot;
  originalSourceRaw: string;
  actualUsdtRaw: string;
  refreshedTarget: RepresentationSnapshot;
  refreshedLeg2: QuoteSnapshot | null;
  maxExposureLossBps: number;
};

export function recheckLeg2AfterLeg1(input: Leg2RecheckInput): "PASS" | "PARTIAL_ROUTE_STOPPED" {
  try {
    validateRepresentation(input.originalSource, "source");
    validateRepresentation(input.refreshedTarget, "target");
    if (!input.refreshedTarget.open || !input.refreshedLeg2 || !/^[1-9]\d*$/.test(input.actualUsdtRaw) ||
        !Number.isInteger(input.maxExposureLossBps) || input.maxExposureLossBps < 0 || input.maxExposureLossBps > 10000) return "PARTIAL_ROUTE_STOPPED";
    validateQuote(input.refreshedLeg2, 2, USDT_ADDRESS, input.refreshedTarget.address, input.actualUsdtRaw);
    const source = normalizedShares(input.originalSourceRaw, input.originalSource.decimals, input.originalSource.tokenToShareRatio);
    const target = normalizedShares(input.refreshedLeg2.outputRaw, input.refreshedTarget.decimals, input.refreshedTarget.tokenToShareRatio);
    const allowedLoss = new Decimal(input.maxExposureLossBps).div(10000);
    return new Decimal(1).minus(target.div(source)).lte(allowedLoss) ? "PASS" : "PARTIAL_ROUTE_STOPPED";
  } catch { return "PARTIAL_ROUTE_STOPPED"; }
}
