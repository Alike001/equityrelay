import { describe, expect, it, vi } from "vitest";
import type { QuoteSnapshot } from "@/types/route";
const rpc = vi.hoisted(() => ({ chain:vi.fn(),balance:vi.fn(),price:vi.fn(),read:vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./rpc", () => ({ bscPublicClient: () => ({ getChainId:rpc.chain,getBalance:rpc.balance,getGasPrice:rpc.price,readContract:rpc.read }) }));
import { confirmationExpiryForAction, requireActionReadiness, requireCurrentQuote } from "./readiness";
import type { ExecutionActionV1 } from "@/domain/execution/action";
import type { ExecutionSession } from "@/types/execution";

const now = new Date("2026-09-29T18:00:30.000Z");
const quote = { quoteId: "fresh", observedAt: "2026-09-29T18:00:10.000Z", expiresAt: null } as QuoteSnapshot;
describe("execution quote review window", () => {
  it("accepts current quote, but not another, stale, expired or future quote", () => {
    expect(() => requireCurrentQuote(quote, "fresh", now)).not.toThrow();
    expect(() => requireCurrentQuote(quote, "old", now)).toThrow("QUOTE_REVIEW_EXPIRED");
    expect(() => requireCurrentQuote({ ...quote, observedAt: "2026-09-29T17:00:00.000Z" }, "fresh", now)).toThrow("QUOTE_REVIEW_EXPIRED");
    expect(() => requireCurrentQuote({ ...quote, expiresAt: "2026-09-29T18:00:29.000Z" }, "fresh", now)).toThrow("QUOTE_REVIEW_EXPIRED");
    expect(() => requireCurrentQuote({ ...quote, observedAt: "2026-09-29T18:01:00.000Z" }, "fresh", now)).toThrow("QUOTE_REVIEW_EXPIRED");
  });
  it("clips a confirmation to the reviewed quote window and provider expiry", () => {
    const action = { stage: "LEG1_SWAP", planIdentity: "fresh" } as ExecutionActionV1;
    const session = { initialQuote: quote } as ExecutionSession;
    expect(confirmationExpiryForAction(session,action,now).toISOString()).toBe("2026-09-29T18:00:40.000Z");
    const provider = { ...quote, expiresAt: "2026-09-29T18:00:35.000Z" };
    expect(confirmationExpiryForAction({ initialQuote: provider } as ExecutionSession,action,now).toISOString()).toBe("2026-09-29T18:00:35.000Z");
    expect(() => confirmationExpiryForAction({ initialQuote: { ...quote, observedAt: "2026-09-29T18:00:00.000Z" } } as ExecutionSession,action,now))
      .toThrow("QUOTE_REFRESH_REQUIRED");
  });
  it("accepts a positive persisted approval gas limit for confirmation readiness", async () => {
    rpc.chain.mockResolvedValue(56); rpc.balance.mockResolvedValue(1_000_000n); rpc.price.mockResolvedValue(1n); rpc.read.mockResolvedValue(5n);
    const action = { kind:"APPROVAL",from:"0x1111111111111111111111111111111111111111",
      tokenIn:"0x55d398326f99059ff775485246999027b3197955",amountInRaw:"5" } as unknown as ExecutionActionV1;
    await expect(requireActionReadiness(action,"55200")).resolves.toBeUndefined();
  });
});
