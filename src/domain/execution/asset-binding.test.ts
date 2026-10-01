import { describe, expect, it } from "vitest";
import { equityConfig, type SupportedUnderlying } from "@/domain/equities/registry";
import { USDT_ADDRESS } from "@/domain/routing/identity";
import type { ExecutionActionV1 } from "./action";
import { assertActionMatchesEquity } from "./asset-binding";

const wallet = "0x1111111111111111111111111111111111111111";
const router = "0x2222222222222222222222222222222222222222";
function leg1(underlying: SupportedUnderlying): ExecutionActionV1 {
  const config = equityConfig(underlying);
  return { version: "ExecutionActionV1", routeId: "route", stage: "LEG1_SWAP", kind: "SWAP", chainId: 56,
    from: wallet, to: router, data: "0x12345678", valueWei: "0", tokenIn: config.sourceAddress,
    tokenOut: USDT_ADDRESS, amountInRaw: "1", approvalSpender: null, approvalAmountRaw: null,
    planIdentity: "quote", planRevision: "revision" };
}

describe("execution action equity binding", () => {
  it.each(["NVDA","SPCX","TSLA"] as const)("accepts the configured %s identities", underlying => {
    expect(() => assertActionMatchesEquity(underlying,leg1(underlying))).not.toThrow();
  });
  it("rejects cross-asset source, destination market, and approval identities", () => {
    expect(() => assertActionMatchesEquity("NVDA",leg1("TSLA"))).toThrow("CROSS_ASSET_ACTION_MISMATCH");
    const spcx = equityConfig("SPCX"), nvda = equityConfig("NVDA"), tsla = equityConfig("TSLA");
    const wrongMarket = { ...leg1("SPCX"), stage: "VENUS_DEPOSIT", kind: "DEPOSIT", tokenIn: spcx.targetAddress,
      tokenOut: null, to: nvda.venusMarketAddress } satisfies ExecutionActionV1;
    expect(() => assertActionMatchesEquity("SPCX",wrongMarket)).toThrow("CROSS_ASSET_ACTION_MISMATCH");
    const wrongApproval = { ...leg1("TSLA"), stage: "VENUS_APPROVAL", kind: "APPROVAL", tokenIn: tsla.targetAddress,
      tokenOut: null, to: tsla.targetAddress, approvalSpender: spcx.venusMarketAddress, approvalAmountRaw: "1" } satisfies ExecutionActionV1;
    expect(() => assertActionMatchesEquity("TSLA",wrongApproval)).toThrow("CROSS_ASSET_ACTION_MISMATCH");
  });
});
