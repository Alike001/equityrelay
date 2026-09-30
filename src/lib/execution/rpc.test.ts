import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { boundedLogs, readBscWithRetry } from "./rpc";

describe("idempotent BSC read behavior", () => {
  it("retries transient read limits and does not retry semantic errors", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("RPC -32005 limit exceeded")).mockResolvedValueOnce("ok");
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(readBscWithRetry(read, wait)).resolves.toBe("ok");
    expect(wait).toHaveBeenCalledWith(250);
    const semantic = vi.fn().mockRejectedValue(new Error("WRONG_RPC_CHAIN"));
    await expect(readBscWithRetry(semantic, wait)).rejects.toThrow("WRONG_RPC_CHAIN");
    expect(semantic).toHaveBeenCalledTimes(1);
  });
  it("pages exact contract/topic reads and refuses unbounded ranges", async () => {
    const address = "0x1111111111111111111111111111111111111111" as const, topic = "0x1234" as const;
    const read = vi.fn(async (from: bigint, to: bigint) => [`${from}-${to}`]);
    expect(await boundedLogs({ fromBlock: 10n, toBlock: 14n, address, topic, pageSize: 2n, read })).toEqual(["10-11", "12-13", "14-14"]);
    expect(read).toHaveBeenCalledTimes(3);
    await expect(boundedLogs({ fromBlock: 0n, toBlock: 10_001n, address, topic, read })).rejects.toThrow("INVALID_BOUNDED_LOG_RANGE");
  });
});
