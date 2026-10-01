import { describe, expect, it } from "vitest";
import { equityConfig, SUPPORTED_UNDERLYINGS } from "./registry";
import { venusVerifierProfile, venusVerifierProfileByMarket } from "./venus-profiles";

describe("server-owned Venus verifier profiles", () => {
  it.each(SUPPORTED_UNDERLYINGS)("binds %s to its bStock, market, implementation and ABI semantics", underlying => {
    const config = equityConfig(underlying);
    const profile = venusVerifierProfile(underlying);
    expect(profile).toMatchObject({ underlying, underlyingToken: config.targetAddress, market: config.venusMarketAddress,
      marketSymbol: `v${config.targetSymbol}`, implementation: "0xcdfea50f7ceccb24fe804657db8e6c93b689941e",
      depositSelectors: ["0xa0712d68", "0x23323e03"], redeemSelectors: ["0xdb006a75"] });
    expect(venusVerifierProfileByMarket(config.venusMarketAddress)).toEqual(profile);
  });

  it("does not resolve a browser-selected arbitrary market", () => {
    expect(venusVerifierProfileByMarket("0x1111111111111111111111111111111111111111")).toBeNull();
  });
});
