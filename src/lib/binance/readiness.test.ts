import { beforeEach, describe, expect, it, vi } from "vitest";
import { NVDAON_ADDRESS, NVDAB_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import type { QuoteSnapshot } from "@/types/route";
import { BinanceApiError } from "./client";

vi.mock("server-only", () => ({}));
vi.mock("./rwa", () => ({ discoverRepresentations: vi.fn() }));
vi.mock("./defi", () => ({ discoverVenusInvestment: vi.fn() }));
vi.mock("./wallet", () => ({ getProofWalletBalances: vi.fn() }));
vi.mock("./trading", () => ({ requestQuote: vi.fn() }));
vi.mock("./defi-transaction", () => ({ buildVenusDeposit: vi.fn() }));
vi.mock("./swap-build", () => ({ buildSwapTransaction: vi.fn() }));
vi.mock("./gas", () => ({ estimateProofGas: vi.fn() }));

import { buildMainnetReadiness } from "./readiness";
import { discoverRepresentations } from "./rwa";
import { discoverVenusInvestment } from "./defi";
import { getProofWalletBalances } from "./wallet";
import { requestQuote } from "./trading";
import { buildVenusDeposit } from "./defi-transaction";
import { buildSwapTransaction } from "./swap-build";
import { estimateProofGas } from "./gas";

const owner = "0x1111111111111111111111111111111111111111";
const now = () => new Date().toISOString();
function quote(leg: 1 | 2, from: `0x${string}`, to: `0x${string}`, inputRaw: string, outputRaw: string): QuoteSnapshot {
  return { leg, from, to, inputRaw, outputRaw, inputDecimals: 18, outputDecimals: 18, vendor: null, quoteId: "live-quote", tradeFeeUsd: null, priceImpactPercent: null, observedAt: now(), expiresAt: null };
}
beforeEach(() => {
  vi.resetAllMocks();
  const observedAt = now();
  vi.mocked(discoverRepresentations).mockResolvedValue({
    source: { chainId: 56, underlying: "NVDA", issuer: "ondo", symbol: "NVDAon", address: NVDAON_ADDRESS, decimals: 18, tokenToShareRatio: "1", open: true, observedAt },
    target: { chainId: 56, underlying: "NVDA", issuer: "bstock", symbol: "NVDAB", address: NVDAB_ADDRESS, decimals: 18, tokenToShareRatio: "1", open: true, observedAt },
  });
  vi.mocked(discoverVenusInvestment).mockResolvedValue({ protocol: "Venus", chainId: 56, investmentId: "live-investment", assetAddress: NVDAB_ADDRESS, investable: true, observedAt });
  vi.mocked(getProofWalletBalances).mockResolvedValue({ walletShort: "0x1111…1111", observedAt, assets: Object.fromEntries(["BNB", "NVDAon", "USDT", "NVDAB"].map(asset => [asset, { asset, balance: "0", rawBalance: "0", reported: false }])) as Awaited<ReturnType<typeof getProofWalletBalances>>["assets"] });
  vi.mocked(requestQuote).mockImplementation(async (leg, from, to, inputRaw) => {
    if (from === NVDAON_ADDRESS && BigInt(inputRaw) < 22000000000000000n) throw new BinanceApiError("/quote", 200, "40375", "Minimum order amount is 5 USD.");
    if (from === NVDAON_ADDRESS) return quote(leg, from, to, inputRaw, "4000000000000000000");
    if (to === NVDAB_ADDRESS) return quote(leg, from, to, inputRaw, "22000000000000000");
    if (to === NVDAON_ADDRESS) return quote(leg, from, to, inputRaw, "22000000000000000");
    return null;
  });
  vi.mocked(buildVenusDeposit).mockResolvedValue({ label: "Prepare Venus", indicative: true, buildStatus: "READY", actions: [], simulationStatus: "BLOCKED_BY_WALLET_STATE", simulationPrerequisite: "INDICATIVE_AFTER_LEG1", authorizationStatus: "BOUNDED_READY", rejectedAuthorization: null, reason: "40484: Insufficient balance", previewDetails: null });
  vi.mocked(buildSwapTransaction).mockResolvedValue({ executionMode: "SWAP", actions: [], evmTx: null, minReceiveRaw: null, quoteOutputRaw: "1" });
  vi.mocked(estimateProofGas).mockResolvedValue({ priceWei: "1000000000", priceSource: "LEGACY_MEDIUM", proofGasUnits: "100000", setupGasUnits: "100000", knownProofGasUnits: "100000", knownProofCostBNB: "0.0001", estimatedProofCostBNB: "0.0001", estimatedSetupCostBNB: "0.0001", recommendedProofGasReserveBNB: "0.0002", recommendedTotalGasReserveBNB: "0.0004", provisionalTechnicalReserveBNB: null, bufferMultiplier: "2", complete: true, missing: [] });
});
describe("live readiness orchestration", () => {
  it("finds the first full route and quotes USDT acquisition only as TEST_SETUP", async () => {
    const result = await buildMainnetReadiness(owner);
    expect(result.kind).toBe("readiness");
    if (result.kind !== "readiness") return;
    expect(result.candidates.map(x => [x.amount, x.status])).toEqual([["0.021", "BELOW_MINIMUM"], ["0.022", "WALLET_STATE_BLOCKED"]]);
    expect(result.smallestViable?.amount).toBe("0.022");
    expect(result.acquisition).toMatchObject({ kind: "TEST_SETUP", required: true, status: "AVAILABLE", usdtInput: "4", quotedNvdaonOutput: "0.022" });
    expect(requestQuote).toHaveBeenCalledWith(2, USDT_ADDRESS, NVDAON_ADDRESS, "4000000000000000000", owner);
    expect(buildVenusDeposit).toHaveBeenCalledWith(owner, expect.objectContaining({ investmentId: "live-investment" }), expect.objectContaining({ address: NVDAB_ADDRESS }), "22000000000000000");
  });
  it("does not call acquisition when the source balance already covers the selected route", async () => {
    const current = await getProofWalletBalances(owner, (await discoverRepresentations()).source, (await discoverRepresentations()).target);
    vi.mocked(getProofWalletBalances).mockResolvedValue({ ...current, assets: { ...current.assets, NVDAon: { asset: "NVDAon", balance: "0.022", rawBalance: "22000000000000000", reported: true } } });
    const result = await buildMainnetReadiness(owner);
    expect(result.kind).toBe("readiness");
    if (result.kind !== "readiness") return;
    expect(result.acquisition).toMatchObject({ kind: "TEST_SETUP", required: false, status: "NOT_REQUIRED" });
    expect(vi.mocked(requestQuote).mock.calls.some(call => call[2] === NVDAON_ADDRESS)).toBe(false);
  });
  it("accepts an omitted Venus approval only when Binance reports no approval is required", async () => {
    vi.mocked(buildVenusDeposit).mockResolvedValue({ label: "Prepare Venus", indicative: true, buildStatus: "READY", actions: [], simulationStatus: "BLOCKED_BY_WALLET_STATE", simulationPrerequisite: "INDICATIVE_AFTER_LEG1", authorizationStatus: "NOT_REQUIRED", rejectedAuthorization: null, reason: "40484: Insufficient balance", previewDetails: null });
    const result = await buildMainnetReadiness(owner);
    expect(result.kind).toBe("readiness");
    if (result.kind !== "readiness") return;
    expect(result.smallestViable?.amount).toBe("0.022");
    expect(result.smallestViable?.status).toBe("WALLET_STATE_BLOCKED");
  });
});
