import "server-only";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";

export function bscPublicClient() {
  const url = process.env.EQUITYRELAY_BSC_RPC_URL;
  if (!url) throw new Error("BSC_RPC_UNAVAILABLE");
  return createPublicClient({ chain: bsc, transport: http(url, { timeout: 10000, retryCount: 0 }) });
}

export function isTransientRpcError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:-32005|rate.?limit|too many requests|\b429\b|timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed)/i.test(message);
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
  // 1rpc.io/bnb accepted a maximum 50-block eth_getLogs window on 2026-09-30.
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
