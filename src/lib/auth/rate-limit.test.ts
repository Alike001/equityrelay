import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { challengeRateKeys, consumeChallengeRate } from "./rate-limit";

const wallet = "0x1111111111111111111111111111111111111111";
describe("database-backed challenge throttling", () => {
  afterEach(() => { delete process.env.EQUITYRELAY_TRUSTED_CLIENT_IP_HEADER; delete process.env.EQUITYRELAY_RATE_LIMIT_SECRET; });
  it("combines wallet, global and trusted-proxy IP buckets without storing raw IP", () => {
    process.env.EQUITYRELAY_TRUSTED_CLIENT_IP_HEADER = "x-real-ip";
    process.env.EQUITYRELAY_RATE_LIMIT_SECRET = "a".repeat(32);
    const request = new Request("http://localhost", { headers: { "x-real-ip": "192.0.2.7" } });
    const keys = challengeRateKeys(request, wallet);
    expect(keys.map(x => x.limit)).toEqual([20,5,1000]);
    expect(JSON.stringify(keys)).not.toContain("192.0.2.7");
    expect(challengeRateKeys(request, wallet)[0].key).toBe(keys[0].key);
    expect(() => challengeRateKeys(new Request("http://localhost"), wallet)).toThrow("AUTH_RATE_LIMIT_CONFIGURATION_REQUIRED");
  });
  it("rejects a full bucket deterministically", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
    const client = { query } as never;
    await consumeChallengeRate(client, [{ key: "wallet:test", limit: 1 }]);
    await expect(consumeChallengeRate(client, [{ key: "wallet:test", limit: 1 }])).rejects.toThrow("AUTH_RATE_LIMITED");
  });
});
