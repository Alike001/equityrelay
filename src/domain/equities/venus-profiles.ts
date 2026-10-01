import type { Address } from "@/types/route";
import { equityConfig, type SupportedUnderlying } from "./registry";

export type VenusVerifierProfile = {
  underlying: SupportedUnderlying;
  underlyingToken: Address;
  market: Address;
  marketSymbol: string;
  implementation: Address;
  depositSelectors: readonly `0x${string}`[];
  redeemSelectors: readonly `0x${string}`[];
  supplyEvents: readonly ("Mint" | "MintBehalf")[];
  redeemEvents: readonly "Redeem"[];
};

const CORE_MARKET_IMPLEMENTATION = "0xcdfea50f7ceccb24fe804657db8e6c93b689941e" as Address;

function profile(underlying: SupportedUnderlying): VenusVerifierProfile {
  const config = equityConfig(underlying);
  return {
    underlying, underlyingToken: config.targetAddress, market: config.venusMarketAddress,
    marketSymbol: `v${config.targetSymbol}`, implementation: CORE_MARKET_IMPLEMENTATION,
    depositSelectors: ["0xa0712d68", "0x23323e03"], redeemSelectors: ["0xdb006a75"],
    supplyEvents: ["Mint", "MintBehalf"], redeemEvents: ["Redeem"],
  };
}

const PROFILES: Record<SupportedUnderlying, VenusVerifierProfile> = {
  NVDA: profile("NVDA"), SPCX: profile("SPCX"), TSLA: profile("TSLA"),
};

export function venusVerifierProfile(underlying: SupportedUnderlying): VenusVerifierProfile {
  return PROFILES[underlying];
}

export function venusVerifierProfileByMarket(market: string): VenusVerifierProfile | null {
  return Object.values(PROFILES).find(profile => profile.market.toLowerCase() === market.toLowerCase()) ?? null;
}
