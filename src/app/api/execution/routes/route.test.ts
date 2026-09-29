import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), begin: vi.fn(), create: vi.fn(), session: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "opaque-cookie" }) }) }));
vi.mock("@/lib/auth/siwe", () => ({ sessionCookie: "equityrelay_session", requireSameOrigin: () => {}, sessionWallet: mocks.session }));
vi.mock("@/lib/binance/preview", () => ({ buildPreview: mocks.preview }));
vi.mock("@/domain/execution/lifecycle", () => ({ beginExecutionSession: mocks.begin }));
vi.mock("@/lib/execution/repository", () => ({ createExecutionRoute: mocks.create }));
import { POST } from "./route";

const wallet = "0x1111111111111111111111111111111111111111";
const intent = { underlying: "NVDA", sourceRepresentation: "ondo", amount: "0.05", destination: "venus", maxExposureLossBps: 50 };
function request(body: unknown) { return new Request("http://localhost:3000/api/execution/routes", { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
describe("authenticated execution route creation", () => {
  it("rejects browser transaction and wallet authority fields", async () => {
    mocks.session.mockResolvedValue(wallet);
    for (const field of ["takerAddress", "to", "data", "value", "quoteId", "investmentId", "tokenAddress", "spender", "approvalAmountRaw"]) {
      const response = await POST(request({ ...intent, [field]: wallet }));
      expect(response.status).toBe(400);
    }
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("uses authenticated session wallet, never a browser claim", async () => {
    mocks.session.mockResolvedValue(wallet);
    mocks.preview.mockResolvedValue({ kind: "decision", state: "PASS" });
    mocks.begin.mockReturnValue({ id: "server-route", stage: "ROUTE_POLICY_PASS" });
    mocks.create.mockResolvedValue(undefined);
    const response = await POST(request(intent));
    expect(response.status).toBe(201);
    expect(mocks.preview).toHaveBeenCalledWith({ ...intent, takerAddress: wallet });
    expect(mocks.create).toHaveBeenCalled();
  });
  it("refuses route creation without a session", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await POST(request(intent));
    expect(response.status).toBe(401);
  });
});
