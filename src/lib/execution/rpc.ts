import "server-only";
import { createPublicClient, http, parseAbiItem, type Address, type Hex } from "viem";
import { bsc } from "viem/chains";

const RPC_PROBE = {
  transactionHash: "0x5516148304443e2461c673f914d3de4140b8f45ef511df05b311fc68c4c55766" as Hex,
  blockNumber: 124836339n,
  market: "0xEb8Ca841cBe1BC4832A10b15c7dAB1081eDaD371" as Address,
  mintEvent: parseAbiItem("event Mint(address minter, uint256 mintAmount, uint256 mintTokens, uint256 totalSupply)"),
};

export type RpcReadinessReason = "WRONG_RPC_CHAIN" | "FINALIZED_UNAVAILABLE" | "RPC_HTTP_FORBIDDEN" |
  "RPC_TIMEOUT" | "RPC_PROBE_EVIDENCE_MISMATCH" | "RPC_VERIFICATION_UNAVAILABLE";
export type CanonicalRpcReadiness =
  | { status: "READY"; chainId: 56; finalizedBlock: string | null; probeBlock: string; boundedLogCount: number }
  | { status: "UNAVAILABLE"; reason: RpcReadinessReason };

export function bscPublicClient() {
  const url = process.env.EQUITYRELAY_BSC_RPC_URL;
  if (!url) throw new Error("BSC_RPC_UNAVAILABLE");
  return createPublicClient({ chain: bsc, transport: http(url, { timeout: 10000, retryCount: 0 }) });
}

export function isTransientRpcError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:-32005|rate.?limit|too many requests|\b429\b|timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed)/i.test(message);
}

export function classifyRpcReadinessFailure(error: unknown): RpcReadinessReason {
  const message = error instanceof Error ? error.message : String(error);
  if (/WRONG_RPC_CHAIN/.test(message)) return "WRONG_RPC_CHAIN";
  if (/FINALIZED_UNAVAILABLE/.test(message)) return "FINALIZED_UNAVAILABLE";
  if (/(?:Status:\s*403|HTTP[_ ]?403|\b403\b.*forbidden|forbidden)/i.test(message)) return "RPC_HTTP_FORBIDDEN";
  if (/(?:timeout|timed out|ETIMEDOUT|AbortError)/i.test(message)) return "RPC_TIMEOUT";
  if (/RPC_PROBE_EVIDENCE_MISMATCH/.test(message)) return "RPC_PROBE_EVIDENCE_MISMATCH";
  return "RPC_VERIFICATION_UNAVAILABLE";
}

type RpcProbeClient = Pick<ReturnType<typeof bscPublicClient>,
  "getChainId" | "getTransaction" | "getTransactionReceipt" | "getBlock" | "getLogs">;

/**
 * Proves the configured endpoint can provide the canonical evidence used by execution.
 * The historical transaction is public Venus activity and is never represented as an
 * EquityRelay execution. A current head-only check would miss archive/log restrictions.
 */
export async function canonicalRpcReadiness(client: RpcProbeClient = bscPublicClient(), requireFinalized = true): Promise<CanonicalRpcReadiness> {
  try {
    const chainId = await readBscWithRetry(() => client.getChainId());
    if (chainId !== 56) throw new Error("WRONG_RPC_CHAIN");
    const transaction = await readBscWithRetry(() => client.getTransaction({ hash: RPC_PROBE.transactionHash }));
    const receipt = await readBscWithRetry(() => client.getTransactionReceipt({ hash: RPC_PROBE.transactionHash }));
    const block = await readBscWithRetry(() => client.getBlock({ blockNumber: RPC_PROBE.blockNumber }));
    const logs = await readBscWithRetry(() => client.getLogs({ address: RPC_PROBE.market, event: RPC_PROBE.mintEvent,
      fromBlock: RPC_PROBE.blockNumber, toBlock: RPC_PROBE.blockNumber }));
    if (transaction.hash.toLowerCase() !== RPC_PROBE.transactionHash.toLowerCase() ||
        transaction.blockNumber !== RPC_PROBE.blockNumber || receipt.transactionHash.toLowerCase() !== RPC_PROBE.transactionHash.toLowerCase() ||
        receipt.blockNumber !== RPC_PROBE.blockNumber || transaction.blockHash !== receipt.blockHash || block.hash !== receipt.blockHash ||
        !logs.some(log => log.transactionHash?.toLowerCase() === RPC_PROBE.transactionHash.toLowerCase()))
      throw new Error("RPC_PROBE_EVIDENCE_MISMATCH");
    let finalizedBlock: string | null = null;
    if (requireFinalized) {
      let finalized;
      try { finalized = await readBscWithRetry(() => client.getBlock({ blockTag: "finalized" })); }
      catch (error) {
        const reason = classifyRpcReadinessFailure(error);
        if (reason === "RPC_HTTP_FORBIDDEN" || reason === "RPC_TIMEOUT") throw error;
        throw new Error("FINALIZED_UNAVAILABLE");
      }
      if (finalized.number < RPC_PROBE.blockNumber) throw new Error("FINALIZED_UNAVAILABLE");
      finalizedBlock = finalized.number.toString();
    }
    return { status: "READY", chainId: 56, finalizedBlock, probeBlock: RPC_PROBE.blockNumber.toString(), boundedLogCount: logs.length };
  } catch (error) {
    return { status: "UNAVAILABLE", reason: classifyRpcReadinessFailure(error) };
  }
}

export async function readBscWithRetry<T>(read: () => Promise<T>, wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await read(); }
    catch (error) {
      if (attempt === 2 || !isTransientRpcError(error)) throw error;
      await wait(250 * 2 ** attempt);
    }
  }
  throw new Error("RPC_RETRY_EXHAUSTED");
}

export async function boundedLogs<T>(input: {
  fromBlock: bigint; toBlock: bigint; address: `0x${string}`; topic: `0x${string}`;
  read: (fromBlock: bigint, toBlock: bigint, address: `0x${string}`, topic: `0x${string}`) => Promise<T[]>;
  pageSize?: bigint;
}): Promise<T[]> {
  // Keep the conservative range proven across the deployment rehearsal providers.
  const size = input.pageSize ?? 50n;
  if (input.fromBlock > input.toBlock || size < 1n || size > 1000n || input.toBlock - input.fromBlock > 10_000n)
    throw new Error("INVALID_BOUNDED_LOG_RANGE");
  const result: T[] = [];
  for (let from = input.fromBlock; from <= input.toBlock; from += size) {
    const to = from + size - 1n < input.toBlock ? from + size - 1n : input.toBlock;
    result.push(...await readBscWithRetry(() => input.read(from, to, input.address, input.topic)));
  }
  return result;
}
