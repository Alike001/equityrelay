import "server-only";
import { keccak256, type Address, type Hex } from "viem";
import { bscPublicClient, readBscWithRetry } from "@/lib/execution/rpc";
import { ROUTER_PROVENANCE_EVIDENCE } from "@/domain/execution/router-provenance";

export type RouterCheckStatus = "MATCH" | "MISMATCH" | "RPC_UNAVAILABLE" | "NO_CODE" | "WRONG_CHAIN";
export type RouterCheckResult = {
  status: RouterCheckStatus;
  chainId: number | null;
  blockNumber: string | null;
  checkedAt: string;
  address: Address;
  recordedHash: Hex;
  computedHash: Hex | null;
  currentFacets: Address[] | null;
};

export type RouterCheckClient = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBytecode(input: { address: Address }): Promise<Hex | undefined>;
  readContract(input: { address: Address; abi: readonly unknown[]; functionName: "facetAddresses" }): Promise<readonly Address[]>;
};

const facetLoupeAbi = [{
  type: "function", name: "facetAddresses", stateMutability: "view", inputs: [],
  outputs: [{ name: "facetAddresses_", type: "address[]" }],
}] as const;

export async function checkRouterRuntime(
  client: RouterCheckClient = bscPublicClient() as unknown as RouterCheckClient,
  now = new Date(),
  recordedHash: Hex = ROUTER_PROVENANCE_EVIDENCE.runtimeBytecodeHash as Hex,
): Promise<RouterCheckResult> {
  const base = {
    chainId: null, blockNumber: null, checkedAt: now.toISOString(),
    address: ROUTER_PROVENANCE_EVIDENCE.router,
    recordedHash,
    computedHash: null, currentFacets: null,
  };
  try {
    const chainId = await readBscWithRetry(() => client.getChainId());
    if (chainId !== 56) return { ...base, status: "WRONG_CHAIN", chainId };
    const [blockNumber, bytecode] = await Promise.all([
      readBscWithRetry(() => client.getBlockNumber()),
      readBscWithRetry(() => client.getBytecode({ address: base.address })),
    ]);
    if (!bytecode || bytecode === "0x") return { ...base, status: "NO_CODE", chainId, blockNumber: blockNumber.toString() };
    const computedHash = keccak256(bytecode);
    let currentFacets: Address[] | null = null;
    try {
      currentFacets = [...await readBscWithRetry(() => client.readContract({
        address: base.address, abi: facetLoupeAbi, functionName: "facetAddresses",
      }))];
    } catch { /* Facet visibility is supporting evidence, not a PASS prerequisite. */ }
    return { ...base, status: computedHash.toLowerCase() === base.recordedHash.toLowerCase() ? "MATCH" : "MISMATCH",
      chainId, blockNumber: blockNumber.toString(), computedHash, currentFacets };
  } catch {
    return { ...base, status: "RPC_UNAVAILABLE" };
  }
}

let cached: { until: number; value: RouterCheckResult } | null = null;
let inFlight: Promise<RouterCheckResult> | null = null;
export async function cachedRouterRuntimeCheck(now = Date.now()): Promise<RouterCheckResult> {
  if (cached && cached.until > now) return cached.value;
  if (inFlight) return inFlight;
  inFlight = checkRouterRuntime().then(value => {
    cached = { until: Date.now() + 30_000, value };
    return value;
  }).finally(() => { inFlight = null; });
  return inFlight;
}
