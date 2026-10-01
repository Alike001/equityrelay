import { positiveDecimal, validDecimals } from "@/domain/exposure/decimal";
import type { Address, DestinationSnapshot, RepresentationSnapshot } from "@/types/route";
import { equityConfig, type SupportedUnderlying } from "@/domain/equities/registry";

export const BSC_CHAIN_ID = 56;
export const NVDAON_ADDRESS = "0xa9ee28c80f960b889dfbd1902055218cba016f75" as Address;
export const NVDAB_ADDRESS = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436" as Address;
export const USDT_ADDRESS = "0x55d398326f99059ff775485246999027b3197955" as Address;
export const VENUS_VNVDAB_ADDRESS = "0xeb8ca841cbe1bc4832a10b15c7dab1081edad371" as Address;

export function sameAddress(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase(); }
export function isAddress(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }

export function validateRepresentation(value: RepresentationSnapshot, role: "source" | "target"): void {
  const config = equityConfig(value.underlying);
  const expected = role === "source"
    ? { issuer: config.sourceIssuer, symbol: config.sourceSymbol, address: config.sourceAddress }
    : { issuer: config.targetIssuer, symbol: config.targetSymbol, address: config.targetAddress };
  if (value.chainId !== 56 || value.issuer !== expected.issuer ||
      value.symbol.toLowerCase() !== expected.symbol.toLowerCase() || !isAddress(value.address) ||
      !sameAddress(value.address, expected.address)) throw new Error("INVALID_EVIDENCE");
  validDecimals(value.decimals);
  positiveDecimal(value.tokenToShareRatio);
  if (typeof value.open !== "boolean" || !Number.isFinite(Date.parse(value.observedAt))) throw new Error("INVALID_EVIDENCE");
}

export function validateDestination(value: DestinationSnapshot, underlying: SupportedUnderlying = "NVDA"): void {
  const config = equityConfig(underlying);
  if (value.chainId !== 56 || value.protocol !== "Venus" || !value.investmentId ||
      !isAddress(value.assetAddress) || !sameAddress(value.assetAddress, config.targetAddress) ||
      typeof value.investable !== "boolean" || !Number.isFinite(Date.parse(value.observedAt))) {
    throw new Error("INVALID_EVIDENCE");
  }
}
