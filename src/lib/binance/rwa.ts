import "server-only";
import { z } from "zod";
import { signedRequest } from "./client";
import { isAddress, NVDAON_ADDRESS, NVDAB_ADDRESS, sameAddress } from "@/domain/routing/identity";
import { positiveDecimal, validDecimals } from "@/domain/exposure/decimal";
import type { RepresentationSnapshot } from "@/types/route";

const Row = z.object({
  binanceChainId: z.union([z.string(), z.number()]).optional(),
  underlyingTicker: z.string(), platformId: z.string(), tokenSymbol: z.string(),
  tokenContractAddress: z.string(), decimals: z.union([z.string(), z.number()]), tokenToShareRatio: z.string(),
  statusInfo: z.object({ openState: z.boolean() }),
});

function pick(rows: z.infer<typeof Row>[], role: "source" | "target", observedAt: string): RepresentationSnapshot {
  const expected = role === "source" ? { address: NVDAON_ADDRESS, issuer: "ondo", symbol: "NVDAon" } : { address: NVDAB_ADDRESS, issuer: "bstock", symbol: "NVDAB" };
  const row = rows.find(r => sameAddress(r.tokenContractAddress, expected.address));
  if (!row || String(row.binanceChainId ?? "56") !== "56" || row.underlyingTicker.toUpperCase() !== "NVDA" ||
      row.platformId.toLowerCase() !== expected.issuer || row.tokenSymbol.toLowerCase() !== expected.symbol.toLowerCase() ||
      !isAddress(row.tokenContractAddress)) throw new Error("INVALID_EVIDENCE");
  validDecimals(row.decimals);
  positiveDecimal(row.tokenToShareRatio);
  return {
    chainId: 56, underlying: "NVDA", issuer: expected.issuer as "ondo" | "bstock", symbol: expected.symbol as "NVDAon" | "NVDAB",
    address: row.tokenContractAddress, decimals: validDecimals(row.decimals), tokenToShareRatio: row.tokenToShareRatio,
    open: row.statusInfo.openState, observedAt,
  };
}

export async function discoverRepresentations(): Promise<{ source: RepresentationSnapshot; target: RepresentationSnapshot }> {
  const data = await signedRequest("GET", "/api/v1/dex/market/rwa/tokens", { params: { binanceChainId: "56" } });
  const rows = z.array(Row).parse(data);
  const observedAt = new Date().toISOString();
  return { source: pick(rows, "source", observedAt), target: pick(rows, "target", observedAt) };
}
