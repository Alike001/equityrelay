import { describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
vi.mock("server-only", () => ({}));
import { checkRouterRuntime, type RouterCheckClient } from "./router-check";

const code = "0x60006000" as const;
function client(overrides: Partial<RouterCheckClient> = {}): RouterCheckClient {
  return {
    getChainId: vi.fn().mockResolvedValue(56),
    getBlockNumber: vi.fn().mockResolvedValue(123n),
    getBytecode: vi.fn().mockResolvedValue(code),
    readContract: vi.fn().mockResolvedValue(["0x1111111111111111111111111111111111111111"]),
    ...overrides,
  };
}

describe("public router runtime check", () => {
  it("matches exact runtime bytes and reports the observed block", async () => {
    const result = await checkRouterRuntime(client(), new Date("2026-10-09T12:00:00Z"), keccak256(code));
    expect(result).toMatchObject({ status: "MATCH", chainId: 56, blockNumber: "123", computedHash: keccak256(code), checkedAt: "2026-10-09T12:00:00.000Z" });
  });
  it("fails closed for a mismatched bytecode hash", async () => {
    expect((await checkRouterRuntime(client(), new Date(), `0x${"11".repeat(32)}`)).status).toBe("MISMATCH");
  });
  it("fails closed on the wrong chain before reading code", async () => {
    const rpc = client({ getChainId: vi.fn().mockResolvedValue(1) });
    expect((await checkRouterRuntime(rpc)).status).toBe("WRONG_CHAIN");
    expect(rpc.getBytecode).not.toHaveBeenCalled();
  });
  it("reports missing code without claiming a match", async () => {
    expect((await checkRouterRuntime(client({ getBytecode: vi.fn().mockResolvedValue("0x") }))).status).toBe("NO_CODE");
  });
  it("reports RPC failure without claiming a match", async () => {
    expect((await checkRouterRuntime(client({ getChainId: vi.fn().mockRejectedValue(new Error("offline")) }))).status).toBe("RPC_UNAVAILABLE");
  });
});
