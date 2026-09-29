import { describe, expect, it } from "vitest";
import { beginExecutionDesign, transitionExecution, type ExecutionEvent, type ExecutionState } from "./state";
import { NVDAON_ADDRESS, NVDAB_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import { reviewApproval } from "@/domain/authorization/approval";
import type { Address } from "@/types/route";
import type { QuoteSnapshot, RouteDecision } from "@/types/route";

const oldTime = "2026-09-29T18:00:00.000Z";
const measuredTime = "2026-09-29T18:01:00.000Z";
const freshTime = "2026-09-29T18:02:00.000Z";
const receiptRef = "unit-test-receipt-reference";
const spender = "0x2222222222222222222222222222222222222222" as const;
const authorization = (token: Address, amountRaw: string, requestedAmountRaw = amountRaw) => reviewApproval({ token, spender, requestedAmountRaw, allowedAmountRaw: amountRaw, decimals: 18, source: "BINANCE" });

function preview(): RouteDecision {
  return {
    kind: "decision", state: "PASS", reasons: ["PASS_ROUTE_READY"], amount: "1", maxExposureLossBps: 50,
    sourceShares: "1", targetShares: "0.999", retentionPercent: "99.9", exposureLossPercent: "0.1", observedAt: oldTime, expiresAt: null,
    evidence: {
      sourceRaw: "1000000000000000000",
      source: { chainId: 56, underlying: "NVDA", issuer: "ondo", symbol: "NVDAon", address: NVDAON_ADDRESS, decimals: 18, tokenToShareRatio: "1", open: true, observedAt: oldTime },
      target: { chainId: 56, underlying: "NVDA", issuer: "bstock", symbol: "NVDAB", address: NVDAB_ADDRESS, decimals: 18, tokenToShareRatio: "1", open: true, observedAt: oldTime },
      destination: { protocol: "Venus", chainId: 56, investmentId: "old-investment", assetAddress: NVDAB_ADDRESS, investable: true, observedAt: oldTime },
      leg1: { leg: 1, from: NVDAON_ADDRESS, to: USDT_ADDRESS, inputRaw: "1000000000000000000", outputRaw: "200000000000000000000", quoteId: "old-first", vendor: null, tradeFeeUsd: null, priceImpactPercent: null, observedAt: oldTime, expiresAt: null },
      leg2: { leg: 2, from: USDT_ADDRESS, to: NVDAB_ADDRESS, inputRaw: "200000000000000000000", outputRaw: "999000000000000000", quoteId: "old-second", vendor: null, tradeFeeUsd: null, priceImpactPercent: null, observedAt: oldTime, expiresAt: null },
    },
  };
}

function walk(state: ExecutionState, ...events: ExecutionEvent[]): ExecutionState { return events.reduce(transitionExecution, state); }
function afterLeg1(): ExecutionState {
  return walk(beginExecutionDesign(preview()),
    { kind: "CHECK_ROUTE_POLICY" }, { kind: "AUTHORIZE_LEG1", authorization: authorization(NVDAON_ADDRESS, "1000000000000000000") },
    { kind: "PREFLIGHT_LEG1", simulation: "PASSED" }, { kind: "REQUEST_CONFIRMATION_A" },
    { kind: "SUBMIT_LEG1", userConfirmed: true, broadcastReceiptRef: receiptRef },
    { kind: "CONFIRM_LEG1", confirmedReceiptRef: receiptRef },
    { kind: "MEASURE_USDT", actualRaw: "200000000000000000000", measuredAt: measuredTime });
}
function quote(outputRaw = "999000000000000000"): QuoteSnapshot {
  return { ...preview().evidence.leg2, inputRaw: "200000000000000000000", outputRaw, quoteId: "fresh-second", observedAt: freshTime };
}

describe("future execution state design (no transaction implementation)", () => {
  it("requires separate leg 1 authorization, simulation, confirmation and settlement evidence", () => {
    const initial = beginExecutionDesign(preview());
    expect(() => transitionExecution(initial, { kind: "SUBMIT_LEG1", userConfirmed: true, broadcastReceiptRef: receiptRef })).toThrow("INVALID_EXECUTION_TRANSITION");
    expect(() => walk(initial, { kind: "CHECK_ROUTE_POLICY" }, { kind: "AUTHORIZE_LEG1", authorization: authorization(NVDAON_ADDRESS, "1000000000000000000", "1000000000000000001") })).toThrow("LEG1_AUTHORIZATION_NOT_BOUNDED");
    expect(() => walk(initial, { kind: "CHECK_ROUTE_POLICY" }, { kind: "AUTHORIZE_LEG1", authorization: authorization(NVDAON_ADDRESS, "1000000000000000000") }, { kind: "PREFLIGHT_LEG1", simulation: "BLOCKED_BY_WALLET_STATE" })).toThrow("LEG1_PREFLIGHT_NOT_READY");
    expect(afterLeg1()).toMatchObject({ stage: "ACTUAL_USDT_MEASURED", fundsAsset: "USDT", actualUsdtRaw: "200000000000000000000" });
  });

  it("rejects the old indicative leg 2 quote and any quote for the wrong settled USDT amount", () => {
    const state = afterLeg1();
    expect(() => transitionExecution(state, { kind: "REQUOTE_LEG2", quote: state.preview.evidence.leg2, target: state.preview.evidence.target })).toThrow("FRESH_LEG2_QUOTE_REQUIRED");
    expect(() => transitionExecution(state, { kind: "REQUOTE_LEG2", quote: { ...quote(), inputRaw: "199000000000000000000" }, target: state.preview.evidence.target })).toThrow("FRESH_LEG2_QUOTE_REQUIRED");
    expect(() => transitionExecution(state, { kind: "REQUOTE_LEG2", quote: { ...quote(), observedAt: measuredTime }, target: state.preview.evidence.target })).toThrow("FRESH_LEG2_QUOTE_REQUIRED");
  });

  it("rechecks underlying exposure and stops with funds in USDT when the fresh leg 2 exceeds policy", () => {
    const state = walk(afterLeg1(), { kind: "REQUOTE_LEG2", quote: quote("990000000000000000"), target: preview().evidence.target }, { kind: "RECHECK_POLICY" });
    expect(state).toMatchObject({ stage: "POLICY_RECHECKED", policyRecheck: "PARTIAL_ROUTE_STOPPED" });
    expect(() => transitionExecution(state, { kind: "CONTINUE_LEG2", authorization: authorization(USDT_ADDRESS, "200000000000000000000") })).toThrow("INVALID_EXECUTION_TRANSITION");
    const stopped = transitionExecution(state, { kind: "STOP_AFTER_LEG1" });
    expect(stopped).toMatchObject({ stage: "PARTIAL_ROUTE_STOPPED", fundsAsset: "USDT" });
    expect(() => transitionExecution(stopped, { kind: "REQUOTE_LEG2", quote: quote(), target: preview().evidence.target })).toThrow("INVALID_EXECUTION_TRANSITION");
  });

  it("requires fresh leg 2 approval and a separate confirmation before later stages", () => {
    const state = walk(afterLeg1(), { kind: "REQUOTE_LEG2", quote: quote(), target: preview().evidence.target }, { kind: "RECHECK_POLICY" });
    expect(state.policyRecheck).toBe("PASS");
    expect(() => transitionExecution(state, { kind: "CONTINUE_LEG2", authorization: authorization(USDT_ADDRESS, "200000000000000000000", "200000000000000000001") })).toThrow("LEG2_AUTHORIZATION_NOT_BOUNDED");
    expect(() => transitionExecution(state, { kind: "CONTINUE_LEG2", authorization: authorization(USDT_ADDRESS, "199000000000000000000") })).toThrow("LEG2_AUTHORIZATION_NOT_BOUNDED");
    const ready = transitionExecution(state, { kind: "CONTINUE_LEG2", authorization: authorization(USDT_ADDRESS, "200000000000000000000") });
    expect(ready.stage).toBe("LEG2_AUTHORIZATION_READY");
    expect(() => transitionExecution(ready, { kind: "REQUEST_CONFIRMATION_B", simulation: "BLOCKED_BY_WALLET_STATE" })).toThrow("LEG2_PREFLIGHT_NOT_READY");
    expect(transitionExecution(ready, { kind: "REQUEST_CONFIRMATION_B", simulation: "PASSED" }).stage).toBe("LEG2_USER_CONFIRMATION_REQUIRED");
  });

  it("requires Venus rediscovery after actual NVDAB measurement and a third confirmation", () => {
    const policy = walk(afterLeg1(), { kind: "REQUOTE_LEG2", quote: quote(), target: preview().evidence.target }, { kind: "RECHECK_POLICY" });
    const measured = walk(policy, { kind: "CONTINUE_LEG2", authorization: authorization(USDT_ADDRESS, "200000000000000000000") }, { kind: "REQUEST_CONFIRMATION_B", simulation: "PASSED" },
      { kind: "SUBMIT_LEG2", userConfirmed: true, broadcastReceiptRef: receiptRef }, { kind: "CONFIRM_LEG2", confirmedReceiptRef: receiptRef },
      { kind: "MEASURE_NVDAB", actualRaw: "999000000000000000", measuredAt: "2026-09-29T18:03:00.000Z" });
    expect(() => transitionExecution(measured, { kind: "AUTHORIZE_VENUS", authorization: authorization(NVDAB_ADDRESS, "999000000000000000") })).toThrow("INVALID_EXECUTION_TRANSITION");
    expect(() => transitionExecution(measured, { kind: "REDISCOVER_VENUS", destination: preview().evidence.destination })).toThrow("FRESH_VENUS_DISCOVERY_REQUIRED");
    const rediscovered = transitionExecution(measured, { kind: "REDISCOVER_VENUS", destination: { ...preview().evidence.destination, investmentId: "fresh-investment", observedAt: "2026-09-29T18:04:00.000Z" } });
    const confirmed = walk(rediscovered, { kind: "AUTHORIZE_VENUS", authorization: authorization(NVDAB_ADDRESS, "999000000000000000") }, { kind: "PREFLIGHT_VENUS", simulation: "PASSED" }, { kind: "REQUEST_CONFIRMATION_C" },
      { kind: "SUBMIT_VENUS", userConfirmed: true, broadcastReceiptRef: receiptRef }, { kind: "CONFIRM_VENUS", confirmedReceiptRef: receiptRef }, { kind: "VERIFY_RECEIPT", verifiedReceiptRef: receiptRef });
    expect(confirmed).toMatchObject({ stage: "VERIFIED_RECEIPT", fundsAsset: "VENUS" });
  });
});
