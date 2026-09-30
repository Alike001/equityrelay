import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), prepare: vi.fn(), get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "opaque-cookie" }) }) }));
vi.mock("@/lib/auth/siwe", () => ({ sessionCookie: "equityrelay_session", requireSameOrigin: () => {}, sessionWallet: mocks.session }));
vi.mock("@/lib/execution/initial-review", () => ({ prepareInitialExecutionReview: mocks.prepare }));
vi.mock("@/lib/execution/repository", () => ({ getExecutionRoute: mocks.get }));
vi.mock("@/lib/execution/post-settlement", () => ({ prepareDurableLeg2Review: vi.fn(), prepareDurableVenusReview: vi.fn() }));
vi.mock("@/lib/execution/recovery-review", () => ({ prepareDurableExitReview: vi.fn(), prepareDurableRedeemReview: vi.fn() }));
vi.mock("@/lib/execution/next-action", () => ({ prepareDependentAction: vi.fn() }));
vi.mock("@/lib/execution/test-setup-review", () => ({ prepareDurableTestSetupReview: vi.fn() }));
import { POST } from "./route";

const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
function request(body: unknown) { return new Request(`http://localhost:3000/api/execution/routes/${id}/review`, { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
describe("read-only authenticated action review", () => {
  it("does not accept browser transaction data or quote IDs", async () => {
    mocks.session.mockResolvedValue("0x1111111111111111111111111111111111111111");
    for (const field of ["to", "data", "value", "quoteId", "approvalAmount", "spender", "tokenAddress", "stage"]) {
      expect((await POST(request({ [field]: "forged" }), context)).status).toBe(409);
    }
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("binds review to session wallet and stays read-only", async () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    mocks.session.mockResolvedValue(wallet);
    mocks.get.mockResolvedValue({ state: "ROUTE_POLICY_PASS", session: { recovery: null } });
    mocks.prepare.mockResolvedValue({ actionHash: "0xhash", executionArmed: false });
    const response = await POST(request({}), context);
    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith(id, wallet);
    expect(await response.json()).toMatchObject({ executionArmed: false });
  });
  it("requires an authenticated session", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request({}), context)).status).toBe(401);
  });
});
