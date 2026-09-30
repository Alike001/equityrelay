import { beforeEach, describe, expect, it, vi } from "vitest";
import { NVDAON_ADDRESS, NVDAB_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import type { ExecutionSession } from "@/types/execution";
import type { QuoteSnapshot } from "@/types/route";

const mocks = vi.hoisted(() => ({ discover: vi.fn(), quote: vi.fn(), buildSwap: vi.fn(), venus: vi.fn(), buildDeposit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/binance/rwa", () => ({ discoverRepresentations: mocks.discover }));
vi.mock("@/lib/binance/trading", () => ({ requestQuote: mocks.quote }));
vi.mock("@/lib/binance/swap-build", () => ({ buildSwapTransaction: mocks.buildSwap }));
vi.mock("@/lib/binance/defi", () => ({ discoverVenusInvestment: mocks.venus }));
vi.mock("@/lib/binance/defi-transaction", () => ({ buildVenusDeposit: mocks.buildDeposit }));
import { prepareLeg2FromMeasured, prepareVenusFromMeasured } from "./prepare";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const source = { chainId: 56 as const, underlying: "NVDA" as const, issuer: "ondo" as const, symbol: "NVDAon", address: NVDAON_ADDRESS,
  decimals: 18, tokenToShareRatio: "1", open: true, observedAt: "2026-09-29T18:00:00.000Z" };
const target = { ...source, issuer: "bstock" as const, symbol: "NVDAB", address: NVDAB_ADDRESS };
const actualUsdt = "199000000000000000000", actualNvdab = "998000000000000000";
const base = { id: "route", owner: wallet, intent: { underlying: "NVDA", sourceRepresentation: "ondo", amount: "1", destination: "venus", maxExposureLossBps: 50, takerAddress: wallet },
  originalSource: source, originalSourceRaw: "1000000000000000000", sourceShares: "1", initialLeg2Indicative: { quoteId: "old-quote" },
  leg1Settlement: { actualAmountOutRaw: actualUsdt, confirmedAt: "2026-09-29T18:01:00.000Z" },
  events: [] } as unknown as ExecutionSession;
function quote(outputRaw: string): QuoteSnapshot { return { leg: 2, from: USDT_ADDRESS, to: NVDAB_ADDRESS, inputRaw: actualUsdt,
  outputRaw, quoteId: "fresh-quote", observedAt: "2026-09-29T18:02:00.000Z", expiresAt: null, vendor: null,
  tradeFeeUsd: null, priceImpactPercent: null, inputDecimals: 18, outputDecimals: 18 }; }

describe("settlement-driven read-only preparation", () => {
  beforeEach(() => { for (const mock of Object.values(mocks)) mock.mockReset(); mocks.discover.mockResolvedValue({ target }); });
  it("quotes leg 2 with only actual settled USDT and persists a policy refusal without a build", async () => {
    mocks.quote.mockResolvedValue(quote("990000000000000000"));
    const result = await prepareLeg2FromMeasured({ ...base, stage: "ACTUAL_USDT_MEASURED" });
    expect(mocks.quote).toHaveBeenCalledWith(2, USDT_ADDRESS, NVDAB_ADDRESS, actualUsdt, wallet);
    expect(result.session.stage).toBe("PARTIAL_ROUTE_STOPPED");
    expect(result.session.leg1Settlement?.actualAmountOutRaw).toBe(actualUsdt);
    expect(mocks.buildSwap).not.toHaveBeenCalled();
  });
  it("builds only after fresh quote and policy pass", async () => {
    mocks.quote.mockResolvedValue(quote(actualNvdab));
    mocks.buildSwap.mockResolvedValue({ minReceiveRaw: "996000000000000000" });
    const result = await prepareLeg2FromMeasured({ ...base, stage: "ACTUAL_USDT_MEASURED" });
    expect(result.session.stage).toBe("POLICY_RECHECKED");
    expect(result.session.freshLeg2?.inputRaw).toBe(actualUsdt);
    expect(mocks.buildSwap).toHaveBeenCalledTimes(1);
    await expect(prepareLeg2FromMeasured({ ...base, stage: "LEG1_CONFIRMED" })).rejects.toThrow("ACTUAL_USDT_REQUIRED");
  });
  it("rediscovers Venus and builds using actual settled NVDAB only", async () => {
    const destination = { chainId: 56 as const, protocol: "Venus" as const, investmentId: "fresh-investment", assetAddress: NVDAB_ADDRESS,
      investable: true, observedAt: "2026-09-29T18:04:00.000Z" };
    mocks.venus.mockResolvedValue(destination);
    mocks.buildDeposit.mockResolvedValue({ buildStatus: "READY", authorizationStatus: "BOUNDED_READY", actions: [{ amountInRaw: actualNvdab }] });
    const session = { ...base, stage: "ACTUAL_NVDAB_MEASURED", freshTarget: target,
      leg2Settlement: { actualAmountOutRaw: actualNvdab, confirmedAt: "2026-09-29T18:03:00.000Z" } } as ExecutionSession;
    const result = await prepareVenusFromMeasured(session);
    expect(result.session.stage).toBe("VENUS_REDISCOVERED");
    expect(mocks.buildDeposit).toHaveBeenCalledWith(wallet, destination, target, actualNvdab);
    mocks.venus.mockResolvedValueOnce({ ...destination, investable: false });
    await expect(prepareVenusFromMeasured(session)).rejects.toThrow();
  });
});
