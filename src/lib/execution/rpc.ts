import "server-only";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";

export function bscPublicClient() {
  const url = process.env.EQUITYRELAY_BSC_RPC_URL;
  if (!url) throw new Error("BSC_RPC_UNAVAILABLE");
  return createPublicClient({ chain: bsc, transport: http(url, { timeout: 10000 }) });
}
