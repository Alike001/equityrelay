import { describe, expect, it } from "vitest";
import { prepareTestSetup, verifyTestSetupSettlement } from "./test-setup";
import { NVDAON_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import type { ExecutionSession, ExecutionReview, SettlementEvidence } from "@/types/execution";
const wallet = "0x1111111111111111111111111111111111111111" as const, router = "0x2222222222222222222222222222222222222222" as const;
const quote = { leg: 2 as const, from: USDT_ADDRESS, to: NVDAON_ADDRESS, inputRaw: "5050000000000000000", outputRaw: "22010000000000000",
  quoteId: "setup", vendor: null, tradeFeeUsd: null, priceImpactPercent: null, observedAt: "2026-09-30T12:00:00.000Z", expiresAt: null };
const review = { boundary: "TEST_SETUP", allowanceSufficient: true, approval: null, action: { kind: "SWAP", amountInRaw: quote.inputRaw,
  tokenIn: USDT_ADDRESS, tokenOut: NVDAON_ADDRESS }, quote } as unknown as ExecutionReview;
const session = { id: "route", owner: wallet, stage: "ROUTE_POLICY_PASS", originalSourceRaw: "22000000000000000", testSetup: null,
  reviews: {}, submitted: {}, events: [] } as unknown as ExecutionSession;
describe("separate canonical test setup", () => {
  it("requires enough canonically settled NVDAon before product start", () => {
    let next = prepareTestSetup(session, quote, review);
    next = { ...next, testSetup: { ...next.testSetup!, state: "SETUP_CONFIRMED" } };
    const evidence = { status: "CONFIRMED", transactionHash: `0x${"1".repeat(64)}`, blockNumber: "100", from: wallet, to: router,
      tokenTransfers: [], confirmedAt: "2026-09-30T12:01:00.000Z", actualAmountInRaw: quote.inputRaw,
      actualAmountOutRaw: quote.outputRaw, outputToken: NVDAON_ADDRESS, outputRecipient: wallet } as SettlementEvidence;
    expect(verifyTestSetupSettlement(next, evidence).testSetup?.state).toBe("NVDAON_VERIFIED");
    expect(() => verifyTestSetupSettlement(next, { ...evidence, actualAmountOutRaw: "21999999999999999" })).toThrow("TEST_SETUP_CANONICAL_SETTLEMENT_REQUIRED");
  });
  it("keeps setup labeled outside the product route", () => {
    const prepared = prepareTestSetup(session, quote, review);
    expect(prepared.stage).toBe("ROUTE_POLICY_PASS");
    expect(prepared.events.at(-1)?.kind).toBe("TEST_SETUP_REVIEWED");
  });
});
