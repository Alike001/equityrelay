import { describe, expect, it } from "vitest";
import type { ExecutionActionV1 } from "./action";
import type { ExecutionSession } from "@/types/execution";
import { NVDAON_ADDRESS, NVDAB_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import { requireStepOrder } from "./step-order";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const router = "0x2222222222222222222222222222222222222222" as const;
const amount = "50000000000000000";
const base: ExecutionActionV1 = { version: "ExecutionActionV1", routeId: "route", stage: "LEG1_SWAP", kind: "SWAP", chainId: 56,
  from: wallet, to: router, data: "0x12345678", valueWei: "0", tokenIn: NVDAON_ADDRESS, tokenOut: USDT_ADDRESS,
  amountInRaw: amount, approvalSpender: null, approvalAmountRaw: null, planIdentity: "leg1-quote", planRevision: "rev1" };
const session = { id: "route", owner: wallet, stage: "LEG1_REVIEW", originalSourceRaw: amount,
  initialQuote: { quoteId: "leg1-quote" }, reviews: { LEAVE_ONDO: { allowanceSufficient: false, approval: { status: "BOUNDED_READY", spender: router } } },
  leg1Settlement: null, leg2Settlement: null, freshLeg2: null, policyRecheck: null, venus: null } as unknown as ExecutionSession;

describe("ordered actions inside three financial boundaries", () => {
  it("requires confirmed bounded approval before swap", () => {
    const approval = { ...base, stage: "LEG1_APPROVAL" as const, kind: "APPROVAL" as const, to: NVDAON_ADDRESS,
      tokenOut: null, approvalSpender: router, approvalAmountRaw: amount };
    expect(() => requireStepOrder(session, approval, new Set())).not.toThrow();
    expect(() => requireStepOrder(session, base, new Set())).toThrow("APPROVAL_CONFIRMATION_REQUIRED");
    expect(() => requireStepOrder(session, base, new Set(["LEG1_APPROVAL"]))).not.toThrow();
    expect(() => requireStepOrder(session, { ...approval, approvalAmountRaw: "999" }, new Set())).toThrow("BOUNDED_APPROVAL_REQUIRED");
  });
  it("requires actual settled USDT and a fresh quote for leg 2", () => {
    const action = { ...base, stage: "LEG2_SWAP" as const, tokenIn: USDT_ADDRESS, tokenOut: NVDAB_ADDRESS,
      amountInRaw: "11000000", planIdentity: "fresh-quote" };
    expect(() => requireStepOrder({ ...session, reviews: { ...session.reviews, CHANGE_REPRESENTATION: { allowanceSufficient: true } } } as unknown as ExecutionSession, action, new Set())).toThrow("FRESH_SETTLED_LEG2_REQUIRED");
    const next = { ...session, stage: "LEG2_REVIEW", policyRecheck: "PASS", leg1Settlement: { actualAmountOutRaw: "11000000" },
      freshLeg2: { quoteId: "fresh-quote" }, reviews: { ...session.reviews, CHANGE_REPRESENTATION: { allowanceSufficient: true } } } as unknown as ExecutionSession;
    expect(() => requireStepOrder(next, action, new Set())).not.toThrow();
    expect(() => requireStepOrder(next, { ...action, amountInRaw: "10900000" }, new Set())).toThrow("INDICATIVE_AMOUNT_FORBIDDEN");
    expect(() => requireStepOrder(next, { ...action, planIdentity: "old-quote" }, new Set())).toThrow("FRESH_QUOTE_REQUIRED");
  });
  it("requires settled NVDAB and rediscovered investable Venus", () => {
    const action = { ...base, stage: "VENUS_DEPOSIT" as const, kind: "DEPOSIT" as const, tokenIn: NVDAB_ADDRESS,
      tokenOut: null, amountInRaw: "49900000000000000", planIdentity: "fresh-investment" };
    expect(() => requireStepOrder({ ...session, reviews: { ...session.reviews, SUPPLY_TO_VENUS: { allowanceSufficient: true } } } as unknown as ExecutionSession, action, new Set())).toThrow("SETTLED_VENUS_REVIEW_REQUIRED");
    const next = { ...session, stage: "VENUS_REVIEW", leg2Settlement: { actualAmountOutRaw: "49900000000000000" },
      venus: { investable: true, investmentId: "fresh-investment" },
      reviews: { ...session.reviews, SUPPLY_TO_VENUS: { allowanceSufficient: true } } } as unknown as ExecutionSession;
    expect(() => requireStepOrder(next, action, new Set())).not.toThrow();
    expect(() => requireStepOrder(next, { ...action, amountInRaw: "50000000000000000" }, new Set())).toThrow("INDICATIVE_AMOUNT_FORBIDDEN");
    expect(() => requireStepOrder(next, { ...action, planIdentity: "old-investment" }, new Set())).toThrow("VENUS_REDISCOVERY_REQUIRED");
  });
});
