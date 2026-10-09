import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ origin: vi.fn(), rate: vi.fn(), check: vi.fn() }));
vi.mock("@/lib/auth/siwe", () => ({ requireSameOrigin: mocks.origin }));
vi.mock("@/lib/proof/public-rate-limit", () => ({ consumePublicProofRate: mocks.rate }));
vi.mock("@/lib/proof/router-check", () => ({ cachedRouterRuntimeCheck: mocks.check }));
import { POST } from "./route";

describe("public router proof API", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.check.mockResolvedValue({ status: "MATCH", chainId: 56, blockNumber: "1", checkedAt: "now", address: "0x1", recordedHash: "0x2", computedHash: "0x2", currentFacets: [] }); });
  it("returns only the fixed sanitized proof result", async () => {
    const response = await POST(new Request("https://equityrelay.test/api/proof/router-check", { method: "POST", headers: { Origin: "https://equityrelay.test", "Content-Type": "application/json" }, body: JSON.stringify({ address: "ignored" }) }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "MATCH", chainId: 56 });
    expect(JSON.stringify(body)).not.toMatch(/RPC_URL|DATABASE_URL|API_SECRET|session|confirmationToken/i);
  });
  it("fails deterministically when rate limited", async () => {
    mocks.rate.mockRejectedValueOnce(new Error("AUTH_RATE_LIMITED"));
    const response = await POST(new Request("https://equityrelay.test", { method: "POST", headers: { Origin: "https://equityrelay.test", "Content-Type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(429);
  });
});
