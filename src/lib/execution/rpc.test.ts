import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { boundedLogs, canonicalRpcReadiness, classifyRpcReadinessFailure, readBscWithRetry } from "./rpc";

const probeHash = "0x5516148304443e2461c673f914d3de4140b8f45ef511df05b311fc68c4c55766" as const;
const blockHash = `0x${"a".repeat(64)}` as const;
function probeClient() {
  return {
    getChainId: vi.fn().mockResolvedValue(56),
    getTransaction: vi.fn().mockResolvedValue({ hash: probeHash, blockNumber: 124836339n, blockHash }),
    getTransactionReceipt: vi.fn().mockResolvedValue({ transactionHash: probeHash, blockNumber: 124836339n, blockHash }),
    getBlock: vi.fn().mockImplementation(({ blockTag }: { blockTag?: string }) => Promise.resolve(blockTag === "finalized" ?
      { number: 124836400n, hash: `0x${"b".repeat(64)}` } : { number: 124836339n, hash: blockHash })),
    getLogs: vi.fn().mockResolvedValue([{ transactionHash: probeHash }]),
  };
}

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
  it("requires chain, transaction, receipt, block, exact logs and finalized evidence", async () => {
    const client = probeClient();
    await expect(canonicalRpcReadiness(client as never, true)).resolves.toEqual({ status: "READY", chainId: 56,
      finalizedBlock: "124836400", probeBlock: "124836339", boundedLogCount: 1 });
    expect(client.getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 124836339n, toBlock: 124836339n }));
  });
  it("refuses readiness when finalized is unavailable", async () => {
    const client = probeClient();
    client.getBlock.mockImplementation(({ blockTag }: { blockTag?: string }) => blockTag === "finalized" ?
      Promise.reject(new Error("finalized unsupported")) : Promise.resolve({ number: 124836339n, hash: blockHash }));
    await expect(canonicalRpcReadiness(client as never, true)).resolves.toEqual({ status: "UNAVAILABLE", reason: "FINALIZED_UNAVAILABLE" });
    client.getBlock.mockImplementation(({ blockTag }: { blockTag?: string }) => blockTag === "finalized" ?
      Promise.reject(new Error("HTTP request failed. Status: 403 Details: forbidden")) : Promise.resolve({ number: 124836339n, hash: blockHash }));
    await expect(canonicalRpcReadiness(client as never, true)).resolves.toEqual({ status: "UNAVAILABLE", reason: "RPC_HTTP_FORBIDDEN" });
  });
  it("classifies provider 403 and timeout failures without marking readiness green", async () => {
    for (const [message, reason] of [["HTTP request failed. Status: 403 Details: forbidden", "RPC_HTTP_FORBIDDEN"],
      ["request timed out", "RPC_TIMEOUT"]] as const) {
      const client = probeClient();
      client.getChainId.mockRejectedValue(new Error(message));
      await expect(canonicalRpcReadiness(client as never, true)).resolves.toEqual({ status: "UNAVAILABLE", reason });
      expect(classifyRpcReadinessFailure(new Error(message))).toBe(reason);
    }
  });
  it("fails closed for a provider on the wrong chain or mismatched canonical evidence", async () => {
    const wrongChain = probeClient();
    wrongChain.getChainId.mockResolvedValue(1);
    await expect(canonicalRpcReadiness(wrongChain as never, true)).resolves.toEqual({ status: "UNAVAILABLE", reason: "WRONG_RPC_CHAIN" });
    const mismatched = probeClient();
    mismatched.getLogs.mockResolvedValue([]);
    await expect(canonicalRpcReadiness(mismatched as never, true)).resolves.toEqual({ status: "UNAVAILABLE", reason: "RPC_PROBE_EVIDENCE_MISMATCH" });
  });
});
