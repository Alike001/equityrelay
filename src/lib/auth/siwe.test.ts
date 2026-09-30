import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSiweMessage } from "viem/siwe";
import { hashSecret } from "@/domain/execution/confirmation";

const mocks = vi.hoisted(() => ({ poolQuery: vi.fn(), clientQuery: vi.fn(), verify: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pool", () => ({ executionPool: () => ({ query: mocks.poolQuery }), transaction: async (work: (client: { query: typeof mocks.clientQuery }) => Promise<unknown>) => work({ query: mocks.clientQuery }) }));
vi.mock("@/lib/execution/rpc", () => ({ bscPublicClient: () => ({}) }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeChallengeRate: async () => {} }));
vi.mock("viem/siwe", async importOriginal => ({ ...(await importOriginal<typeof import("viem/siwe")>()), verifySiweMessage: mocks.verify }));
import { configuredOrigin, createChallenge, requireSameOrigin, verifyChallenge } from "./siwe";

const wallet = "0x1111111111111111111111111111111111111111";
describe("SIWE wallet authority", () => {
  beforeEach(() => { process.env.EQUITYRELAY_PUBLIC_ORIGIN = "http://localhost:3000"; mocks.poolQuery.mockReset(); mocks.clientQuery.mockReset(); mocks.verify.mockReset(); });
  afterEach(() => { delete process.env.EQUITYRELAY_PUBLIC_ORIGIN; });
  it("binds claimed wallet, chain, origin and expiry while storing only nonce hash", async () => {
    mocks.poolQuery.mockResolvedValue({ rowCount: 1 });
    const challenge = await createChallenge(wallet);
    const parsed = parseSiweMessage(challenge.message);
    expect(parsed).toMatchObject({ address: wallet, chainId: 56, domain: "localhost:3000", uri: "http://localhost:3000" });
    expect(parsed.expirationTime).toBeDefined();
    const values = mocks.clientQuery.mock.calls[0][1] as unknown[];
    expect(values[0]).toBe(hashSecret(parsed.nonce!));
    expect(values[0]).not.toBe(parsed.nonce);
    expect(() => configuredOrigin()).not.toThrow();
    expect(() => requireSameOrigin(new Request("http://localhost:3000/api", { method: "POST", headers: { Origin: "http://evil.example", "Content-Type": "application/json" } }))).toThrow("ORIGIN_MISMATCH");
  });
  it("rejects wrong signer and atomically consumes a valid nonce before issuing hashed session", async () => {
    const challenge = await createChallenge(wallet);
    mocks.poolQuery.mockResolvedValue({ rows: [{ wallet: wallet.toLowerCase(), message: challenge.message,
      expires_at: new Date(Date.now() + 60_000), consumed_at: null }] });
    mocks.verify.mockResolvedValueOnce(false);
    await expect(verifyChallenge(challenge.message, "0x1234")).rejects.toThrow("SIWE_SIGNATURE_INVALID");
    expect(mocks.clientQuery).toHaveBeenCalledTimes(1);
    mocks.verify.mockResolvedValueOnce(true);
    mocks.clientQuery.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 1 });
    const verified = await verifyChallenge(challenge.message, "0x1234");
    expect(verified.wallet).toBe(wallet.toLowerCase());
    expect(mocks.clientQuery.mock.calls[1][0]).toContain("consumed_at IS NULL AND expires_at>now()");
    expect(mocks.clientQuery.mock.calls[2][1][0]).toBe(hashSecret(verified.sessionToken));
    expect(JSON.stringify(mocks.clientQuery.mock.calls)).not.toContain(verified.sessionToken);
  });
  it("rejects a consumed or expired challenge before signature verification", async () => {
    const challenge = await createChallenge(wallet);
    mocks.poolQuery.mockResolvedValueOnce({ rows: [{ wallet, message: challenge.message, expires_at: new Date(Date.now() + 60_000), consumed_at: new Date() }] });
    await expect(verifyChallenge(challenge.message, "0x1234")).rejects.toThrow("SIWE_CHALLENGE_EXPIRED_OR_USED");
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("rejects tampered chain, origin, and claimed wallet", async () => {
    const challenge = await createChallenge(wallet);
    await expect(verifyChallenge(challenge.message.replace("Chain ID: 56", "Chain ID: 1"), "0x1234")).rejects.toThrow("INVALID_SIWE_CHALLENGE");
    await expect(verifyChallenge(challenge.message.replace("localhost:3000", "evil.example"), "0x1234")).rejects.toThrow("INVALID_SIWE_CHALLENGE");
    mocks.poolQuery.mockResolvedValue({ rows: [{ wallet, message: challenge.message,
      expires_at: new Date(Date.now() + 60_000), consumed_at: null }] });
    await expect(verifyChallenge(challenge.message.replace(wallet, "0x2222222222222222222222222222222222222222"), "0x1234")).rejects.toThrow();
  });
});
