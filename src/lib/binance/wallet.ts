import "server-only";
import { signedRequest } from "./client";
import { parseRequestedBalances } from "@/domain/readiness/balance";
import { USDT_ADDRESS } from "@/domain/routing/identity";
import type { Address, RepresentationSnapshot } from "@/types/route";
import type { WalletReadiness, ProofAsset } from "@/types/readiness";

export async function getProofWalletBalances(owner: Address, source: RepresentationSnapshot, target: RepresentationSnapshot): Promise<WalletReadiness> {
  // Binance Wallet connector: the native asset is an empty contract address for this endpoint.
  const requested: Record<ProofAsset, Address | ""> = { BNB: "", NVDAon: source.address, USDT: USDT_ADDRESS, NVDAB: target.address };
  const data = await signedRequest("POST", "/api/v1/dex/balance/token-balances-by-address", {
    body: { address: owner, tokenContractAddresses: Object.values(requested).map(tokenContractAddress => ({ binanceChainId: "56", tokenContractAddress })), excludeRiskToken: "1" },
  });
  return parseRequestedBalances(data, owner, requested);
}
