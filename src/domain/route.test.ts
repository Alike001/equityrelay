import { describe, expect, it } from "vitest";
import { normalizedShares, toRawUnits } from "@/domain/exposure/decimal";
import { evaluateRoute, orderedReasons, recheckLeg2AfterLeg1 } from "@/domain/policy/evaluate";
import { NVDAON_ADDRESS, NVDAB_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import type { BrowserIntent, RouteEvidence } from "@/types/route";

const observedAt = "2026-09-29T12:00:00.000Z";
const intent: BrowserIntent = { underlying: "NVDA", sourceRepresentation: "ondo", amount: "1", destination: "venus", maxExposureLossBps: 50, takerAddress: "0x1111111111111111111111111111111111111111" };
const evidence: RouteEvidence = {
  source: { chainId: 56, underlying: "NVDA", issuer: "ondo", symbol: "NVDAon", address: NVDAON_ADDRESS, decimals: 18, tokenToShareRatio: "1.0017152487959898", open: true, observedAt },
  target: { chainId: 56, underlying: "NVDA", issuer: "bstock", symbol: "NVDAB", address: NVDAB_ADDRESS, decimals: 18, tokenToShareRatio: "1.000778223752807865", open: true, observedAt },
  destination: { protocol: "Venus", chainId: 56, investmentId: "live-investment", assetAddress: NVDAB_ADDRESS, investable: true, observedAt },
  leg1: { leg: 1, from: NVDAON_ADDRESS, to: USDT_ADDRESS, inputRaw: "1000000000000000000", outputRaw: "1000000000000000000", vendor: "vendor", quoteId: null, tradeFeeUsd: null, priceImpactPercent: null, observedAt, expiresAt: null },
  leg2: { leg: 2, from: USDT_ADDRESS, to: NVDAB_ADDRESS, inputRaw: "1000000000000000000", outputRaw: "1000000000000000000", vendor: "vendor", quoteId: null, tradeFeeUsd: null, priceImpactPercent: null, observedAt, expiresAt: null },
  sourceRaw: "1000000000000000000",
};
const copy = (): RouteEvidence => structuredClone(evidence);

describe("exposure and policy", () => {
  it("converts human amounts to exact raw units", () => {
    expect(toRawUnits("0.25", 18)).toBe("250000000000000000");
    expect(() => toRawUnits("0.0001", 3)).toThrow();
  });
  it("normalizes different wrapper ratios", () => {
    expect(normalizedShares("1000000000000000000", 18, evidence.source.tokenToShareRatio).toFixed()).toBe("1.0017152487959898");
    expect(normalizedShares("1000000000000000000", 18, evidence.target.tokenToShareRatio).toFixed()).toBe("1.000778223752807865");
  });
  it("passes below and exactly at the policy boundary", () => {
    expect(evaluateRoute(intent, evidence).state).toBe("PASS");
    const exact = copy(); exact.source.tokenToShareRatio = "1"; exact.target.tokenToShareRatio = "1"; exact.leg2.outputRaw = "995000000000000000";
    expect(evaluateRoute(intent, exact).state).toBe("PASS");
  });
  it("blocks above policy even if display rounds to the threshold", () => {
    const near = copy(); near.source.tokenToShareRatio = "1"; near.target.tokenToShareRatio = "1"; near.leg2.outputRaw = "994999999999999999";
    const result = evaluateRoute(intent, near);
    expect(result.state).toBe("BLOCKED");
    expect(result.reasons).toContain("BLOCK_EXPOSURE_POLICY");
  });
  it.each(["0", "-1", "NaN"])("rejects ratio %s", ratio => {
    const item = copy(); item.source.tokenToShareRatio = ratio;
    expect(() => evaluateRoute(intent, item)).toThrow();
  });
  it("rejects malformed decimals and identity evidence", () => {
    for (const mutate of [
      (x: RouteEvidence) => { x.source.decimals = -1; },
      (x: RouteEvidence) => { x.source.chainId = 97 as 56; },
      (x: RouteEvidence) => { x.source.underlying = "TSLA" as "NVDA"; },
      (x: RouteEvidence) => { x.source.issuer = "bstock"; },
      (x: RouteEvidence) => { x.source.address = NVDAB_ADDRESS; },
      (x: RouteEvidence) => { x.destination.assetAddress = NVDAON_ADDRESS; },
    ]) { const item = copy(); mutate(item); expect(() => evaluateRoute(intent, item)).toThrow(); }
  });
  it("blocks a non-investable Venus market", () => {
    const item = copy(); item.destination.investable = false;
    expect(evaluateRoute(intent, item).reasons).toContain("BLOCK_DESTINATION_NOT_INVESTABLE");
  });
  it("rejects missing destination and malformed quote output", () => {
    const missing = copy(); missing.destination.investmentId = "";
    expect(() => evaluateRoute(intent, missing)).toThrow();
    const malformed = copy(); malformed.leg2.outputRaw = "none";
    expect(() => evaluateRoute(intent, malformed)).toThrow();
  });
  it("orders reasons deterministically", () => {
    expect(orderedReasons(["BLOCK_EXPOSURE_POLICY", "BLOCK_SOURCE_STATUS", "BLOCK_SOURCE_STATUS"])).toEqual(["BLOCK_SOURCE_STATUS", "BLOCK_EXPOSURE_POLICY"]);
  });
  it("models a future post-leg-1 stop without executing it", () => {
    const item = copy(); item.leg2.outputRaw = "900000000000000000";
    expect(recheckLeg2AfterLeg1(intent, item)).toBe("PARTIAL_ROUTE_STOPPED");
    expect(recheckLeg2AfterLeg1(intent, null)).toBe("PARTIAL_ROUTE_STOPPED");
  });
});
