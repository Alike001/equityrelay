import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), deliver: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "opaque" }) }) }));
vi.mock("@/lib/auth/siwe", () => ({ sessionCookie: "equityrelay_session", requireSameOrigin: () => {}, sessionWallet: mocks.session }));
vi.mock("@/lib/execution/handoff", () => ({ deliverWalletAction: mocks.deliver }));
vi.mock("@/lib/execution/refresh", () => ({ refreshStaleQuoteReview: mocks.refresh }));
import { POST } from "./route";

const routeId = "11111111-1111-4111-8111-111111111111", stepId = "22222222-2222-4222-8222-222222222222";
const wallet = "0x1111111111111111111111111111111111111111", actionHash = `0x${"a".repeat(64)}`;
const context = { params: Promise.resolve({ id: routeId, stepId }) };
const body = { stage: "LEG1_SWAP", confirmationToken: "x".repeat(40), actionHash, routeVersion: 4 };
function request(value: unknown) { return new Request("https://equityrelay.example/action", { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); }

describe("authenticated wallet action delivery", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue(wallet); });
  it("requires an authenticated session and delivers only server transaction fields", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await POST(request(body),context)).status).toBe(401);
    mocks.deliver.mockResolvedValue({ transaction: { from: wallet, to: "0x2222222222222222222222222222222222222222",
      data: "0x12345678", value: "0x0", chainId: "0x38" }, display: { stage: "LEG1_SWAP", actionHash } });
    const response = await POST(request(body),context);
    expect(response.status).toBe(200);
    expect(mocks.deliver).toHaveBeenCalledWith({ routeId,stepId,wallet,stage:"LEG1_SWAP",token:body.confirmationToken,actionHash,routeVersion:4 });
    expect(await response.json()).toMatchObject({ state: "READY_FOR_WALLET_REVIEW", executionArmed: true });
  });
  it("reports the server execution arm refusal before any wallet action is returned", async () => {
    mocks.deliver.mockRejectedValue(new Error("MAINNET_EXECUTION_NOT_ARMED"));
    const response = await POST(request(body),context);
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({ code: "MAINNET_EXECUTION_NOT_ARMED" });
  });
  it.each(["to","data","value","token","approvalAmount","spender","quoteId"])("rejects browser semantic field %s", async field => {
    const response = await POST(request({ ...body,[field]:"forged" }),context);
    expect(response.status).toBe(409);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("invalidates and regenerates a stale action through the shared refresh path", async () => {
    mocks.deliver.mockRejectedValue(new Error("QUOTE_REFRESH_REQUIRED"));
    mocks.refresh.mockResolvedValue({ stepId: "new-step", actionHash: `0x${"b".repeat(64)}` });
    const response = await POST(request(body),context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "QUOTE_REFRESH_REQUIRED", state: "QUOTE_REFRESH_REQUIRED",
      refreshed: { stepId: "new-step" } });
    expect(mocks.refresh).toHaveBeenCalledWith(routeId,wallet,stepId,actionHash);
  });
});
