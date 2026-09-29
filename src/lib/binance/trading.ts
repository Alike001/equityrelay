import "server-only";
import { z } from "zod";
import { signedRequest } from "./client";
import { sameAddress } from "@/domain/routing/identity";
import { validDecimals } from "@/domain/exposure/decimal";
import type { Address, QuoteSnapshot } from "@/types/route";

const Quote = z.object({
  fromTokenAmount: z.string().regex(/^[1-9]\d*$/),
  toTokenAmount: z.string().regex(/^[1-9]\d*$/),
  vendorName: z.string().optional().nullable(),
  quoteId: z.string().optional().nullable(),
  tradeFee: z.union([z.string(), z.number()]).optional().nullable(),
  priceImpactPercent: z.union([z.string(), z.number()]).optional().nullable(),
  expiresAt: z.union([z.string(), z.number()]).optional().nullable(),
  expireTime: z.union([z.string(), z.number()]).optional().nullable(),
  expiryTime: z.union([z.string(), z.number()]).optional().nullable(),
  fromToken: z.object({ tokenContractAddress: z.string().optional(), tokenAddress: z.string().optional(), decimal: z.string().optional() }).optional(),
  toToken: z.object({ tokenContractAddress: z.string().optional(), tokenAddress: z.string().optional(), decimal: z.string().optional() }).optional(),
});

function expiry(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : null;
  const date = numeric === null ? new Date(value) : new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_EVIDENCE");
  return date.toISOString();
}

export async function requestQuote(leg: 1 | 2, from: Address, to: Address, inputRaw: string, takerAddress: Address): Promise<QuoteSnapshot | null> {
  const data = await signedRequest("GET", "/api/v1/dex/aggregator/quote", {
    params: { binanceChainId: "56", amount: inputRaw, fromTokenAddress: from, toTokenAddress: to, userWalletAddress: takerAddress },
  });
  if (!Array.isArray(data)) throw new Error("INVALID_EVIDENCE");
  if (data.length === 0) return null;
  const quote = Quote.parse(data[0]);
  const returnedFrom = quote.fromToken?.tokenContractAddress ?? quote.fromToken?.tokenAddress;
  const returnedTo = quote.toToken?.tokenContractAddress ?? quote.toToken?.tokenAddress;
  if (quote.fromTokenAmount !== inputRaw || (returnedFrom && !sameAddress(returnedFrom, from)) || (returnedTo && !sameAddress(returnedTo, to))) throw new Error("INVALID_EVIDENCE");
  return {
    leg, from, to, inputRaw, outputRaw: quote.toTokenAmount,
    inputDecimals: quote.fromToken?.decimal == null ? null : validDecimals(quote.fromToken.decimal),
    outputDecimals: quote.toToken?.decimal == null ? null : validDecimals(quote.toToken.decimal),
    vendor: quote.vendorName ?? null, quoteId: quote.quoteId ?? null,
    tradeFeeUsd: quote.tradeFee == null ? null : String(quote.tradeFee),
    priceImpactPercent: quote.priceImpactPercent == null ? null : String(quote.priceImpactPercent),
    observedAt: new Date().toISOString(),
    expiresAt: expiry(quote.expiresAt ?? quote.expireTime ?? quote.expiryTime),
  };
}
