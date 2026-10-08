import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), issue: vi.fn(), invalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "opaque" }) }) }));
vi.mock("@/lib/auth/siwe", () => ({ sessionCookie: "equityrelay_session", requireSameOrigin: () => {}, sessionWallet: mocks.session }));
vi.mock("@/lib/execution/repository", () => ({ issueConfirmation: mocks.issue }));
vi.mock("@/lib/execution/refresh", () => ({ invalidateCurrentStaleQuoteReview: mocks.invalidate }));
import { POST } from "./route";

const id = "11111111-1111-4111-8111-111111111111", wallet = "0x1111111111111111111111111111111111111111";
const context = { params: Promise.resolve({ id }) };
function request(body: unknown) { return new Request(`https://equityrelay.example/api/execution/routes/${id}/confirmations`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

describe("authenticated durable confirmation API", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue(wallet); });
  it("issues only a server-bound reference and no transaction semantics", async () => {
    mocks.issue.mockResolvedValue({ token: "x".repeat(40), routeVersion: 4, step: { id: "step", stage: "VENUS_REDEEM", actionHash: `0x${"a".repeat(64)}` } });
    const response = await POST(request({ operation: "ISSUE", stage: "VENUS_REDEEM", idempotencyKey: id }), context);
    expect(response.status).toBe(200);
    expect(mocks.issue).toHaveBeenCalledWith(id, wallet, "VENUS_REDEEM", id);
    expect(await response.json()).toEqual({ confirmationToken: "x".repeat(40), actionHash: `0x${"a".repeat(64)}`,
      routeVersion: 4, stepId: "step", stage: "VENUS_REDEEM", executionArmed: false });
  });
  it.each(["to", "data", "value", "quoteId", "token", "approvalAmount", "spender"])("rejects browser authority field %s", async field => {
    const response = await POST(request({ operation: "ISSUE", stage: "EXIT_SWAP", idempotencyKey: id, [field]: "forged" }), context);
    expect(response.status).toBe(409);
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("does not expose the old reserve operation that bypassed final action delivery checks", async () => {
    const body = { operation: "RESERVE", stage: "EXIT_SWAP", token: "z".repeat(40), actionHash: `0x${"b".repeat(64)}`, routeVersion: 8 };
    const response = await POST(request(body), context);
    expect(response.status).toBe(409);
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("invalidates an expired review and requires a new explicit review", async () => {
    mocks.issue.mockRejectedValue(new Error("QUOTE_REVIEW_EXPIRED"));
    const response = await POST(request({ operation: "ISSUE", stage: "TEST_SETUP_APPROVAL", idempotencyKey: id }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "QUOTE_REFRESH_REQUIRED", state: "QUOTE_REFRESH_REQUIRED" });
    expect(mocks.invalidate).toHaveBeenCalledWith(id,wallet,"TEST_SETUP_APPROVAL");
  });
});
