import "server-only";
import { z } from "zod";
import { signedRequest } from "./client";
import { sameAddress } from "@/domain/routing/identity";
import { equityConfig, type SupportedUnderlying } from "@/domain/equities/registry";
import type { DestinationSnapshot } from "@/types/route";

const Item = z.object({ investmentId: z.string().min(1), protocolName: z.string().optional(), defiProtocolId: z.string().optional() });
const Detail = z.object({
  investmentId: z.string().min(1), protocolName: z.string(), binanceChainId: z.union([z.string(), z.number()]),
  investable: z.boolean(), assetTokenList: z.array(z.object({ tokenAddress: z.string(), tokenSymbol: z.string() })),
});

export async function discoverVenusInvestment(underlying: SupportedUnderlying = "NVDA"): Promise<DestinationSnapshot | null> {
  const config = equityConfig(underlying);
  const data = await signedRequest("POST", "/api/v1/defi/data/investment/list", {
    body: { investType: "Earn", tokenAddressList: [config.targetAddress], binanceChainId: "56", page: 1, size: 100 },
  });
  const listing = z.object({ list: z.array(Item) }).parse(data);
  const candidate = listing.list.find(x => /venus/i.test(`${x.protocolName ?? ""} ${x.defiProtocolId ?? ""}`));
  if (!candidate) return null;
  const detailData = await signedRequest("POST", "/api/v1/defi/data/investment/detail", { body: { investmentId: candidate.investmentId } });
  const detail = Detail.parse(detailData);
  const asset = detail.assetTokenList.find(x => sameAddress(x.tokenAddress, config.targetAddress));
  if (detail.investmentId !== candidate.investmentId || String(detail.binanceChainId) !== "56" || !/venus/i.test(detail.protocolName) ||
      !asset || asset.tokenSymbol.toLowerCase() !== config.targetSymbol.toLowerCase()) throw new Error("INVALID_EVIDENCE");
  return { protocol: "Venus", chainId: 56, investmentId: detail.investmentId, assetAddress: config.targetAddress, investable: detail.investable, observedAt: new Date().toISOString() };
}
