import "server-only";
import { createPublicClient, http, parseAbi } from "viem";
import { bsc } from "viem/chains";
import { isAddress } from "@/domain/routing/identity";
import type { Address } from "@/types/route";

const erc20 = parseAbi(["function allowance(address owner, address spender) view returns (uint256)"]);
export async function readCurrentAllowance(token: Address, owner: Address, spender: Address): Promise<string> {
  if (![token, owner, spender].every(isAddress) || /^0x0{40}$/i.test(spender)) throw new Error("INVALID_ALLOWANCE_IDENTITY");
  const endpoint = process.env.EQUITYRELAY_BSC_RPC_URL;
  if (!endpoint || !/^https:\/\//.test(endpoint)) throw new Error("BSC_RPC_UNAVAILABLE");
  const client = createPublicClient({ chain: bsc, transport: http(endpoint, { timeout: 12000 }) });
  const amount = await client.readContract({ address: token, abi: erc20, functionName: "allowance", args: [owner, spender] });
  return amount.toString();
}

export function allowanceCovers(allowanceRaw: string, requiredRaw: string): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(allowanceRaw) || !/^[1-9]\d*$/.test(requiredRaw)) throw new Error("INVALID_ALLOWANCE_VALUE");
  return BigInt(allowanceRaw) >= BigInt(requiredRaw);
}
