import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIntent, RouteDecision } from "@/types/route";
import type { PreflightStage } from "@/types/preflight";
import { validateEvmAction } from "@/domain/preflight/validate";
import { encodeExactApproval, reviewApproval } from "@/domain/authorization/approval";
import { NVDAON_ADDRESS, NVDAB_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";

vi.mock("server-only", () => ({}));
vi.mock("./preview", () => ({ buildPreview: vi.fn() }));
vi.mock("./swap-build", () => ({ buildSwapTransaction: vi.fn() }));
vi.mock("./simulation", () => ({ simulateEvmTransaction: vi.fn() }));
vi.mock("./defi-transaction", () => ({ buildVenusDeposit: vi.fn() }));

import { buildRoutePreflight } from "./preflight";
import { buildPreview } from "./preview";
import { buildSwapTransaction } from "./swap-build";
import { simulateEvmTransaction } from "./simulation";
import { buildVenusDeposit } from "./defi-transaction";
import { BinanceApiError } from "./client";

const owner = "0x1111111111111111111111111111111111111111" as const;
const target = "0x2222222222222222222222222222222222222222" as const;
const intent: BrowserIntent = { underlying: "NVDA", sourceRepresentation: "ondo", amount: "1", destination: "venus", maxExposureLossBps: 50, takerAddress: owner };
const now = () => new Date().toISOString();
const simulation = { status: "PASSED" as const, failReason: null, balanceChanges: [], allowanceChanges: [], warnings: [] };

function preview(): RouteDecision {
  const observedAt = now();
  return {
    kind: "decision", state: "PASS", reasons: ["PASS_ROUTE_READY"], amount: "1", maxExposureLossBps: 50,
    sourceShares: "1", targetShares: "0.999", retentionPercent: "99.9", exposureLossPercent: "0.1", observedAt, expiresAt: null,
    evidence: {
      sourceRaw: "1000000000000000000",
      source: { chainId: 56, underlying: "NVDA", issuer: "ondo", symbol: "NVDAon", address: NVDAON_ADDRESS, decimals: 18, tokenToShareRatio: "1", open: true, observedAt },
      target: { chainId: 56, underlying: "NVDA", issuer: "bstock", symbol: "NVDAB", address: NVDAB_ADDRESS, decimals: 18, tokenToShareRatio: "1", open: true, observedAt },
      destination: { protocol: "Venus", chainId: 56, investmentId: "rediscovered-id", assetAddress: NVDAB_ADDRESS, investable: true, observedAt },
      leg1: { leg: 1, from: NVDAON_ADDRESS, to: USDT_ADDRESS, inputRaw: "1000000000000000000", outputRaw: "200000000000000000000", quoteId: "leg1", vendor: null, tradeFeeUsd: null, priceImpactPercent: null, observedAt, expiresAt: null },
      leg2: { leg: 2, from: USDT_ADDRESS, to: NVDAB_ADDRESS, inputRaw: "200000000000000000000", outputRaw: "999000000000000000", quoteId: "leg2", vendor: null, tradeFeeUsd: null, priceImpactPercent: null, observedAt, expiresAt: null },
    },
  };
}

function stage(label: string): PreflightStage {
  return { label, indicative: true, buildStatus: "READY", actions: [], simulationStatus: "PASSED", simulationPrerequisite: "INDICATIVE_AFTER_LEG1", authorizationStatus: "NOT_REQUIRED", rejectedAuthorization: null, reason: null, previewDetails: null };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(buildPreview).mockResolvedValue(preview());
  vi.mocked(buildSwapTransaction).mockImplementation(async quote => ({
    executionMode: "SWAP", actions: [{ ...validateEvmAction({ kind: "SWAP", chainId: 56, from: owner, to: target, data: "0x12345678", value: "0", valueFormat: "decimal-or-hex", tokenIn: quote.from, tokenOut: quote.to, amountInRaw: quote.inputRaw, minAmountOutRaw: quote.outputRaw, expectedFrom: owner }), simulation }],
    evmTx: { from: owner, to: target, value: "0", data: "0x12345678" },
    minReceiveRaw: quote.leg === 1 ? "199900000000000000000" : "998000000000000000",
    quoteOutputRaw: quote.outputRaw,
  }));
  vi.mocked(simulateEvmTransaction).mockResolvedValue(simulation);
  vi.mocked(buildVenusDeposit).mockResolvedValue(stage("Prepare Venus"));
});

describe("route preflight orchestration", () => {
  it("reacquires a PASS route, builds both legs, and marks leg 2 and Venus indicative", async () => {
    const result = await buildRoutePreflight(intent);
    expect(result.kind).toBe("preflight");
    if (result.kind !== "preflight") return;
    expect(result.routePolicy).toBe("PASS");
    expect(result.overallPreflightState).toBe("READY_TO_REVIEW");
    expect(result.authorizationSafety).toBe("REQUIRES_ONCHAIN_ALLOWANCE");
    expect(result.executionReadiness).toBe("NOT_READY");
    expect(result.leg2Indicative.indicative).toBe(true);
    expect(result.venusDepositIndicative.indicative).toBe(true);
    expect(vi.mocked(buildSwapTransaction).mock.calls.map(call => call[0].quoteId)).toEqual(["leg1", "leg2"]);
    expect(buildVenusDeposit).toHaveBeenCalledWith(owner, expect.objectContaining({ investmentId: "rediscovered-id" }), expect.objectContaining({ address: NVDAB_ADDRESS }), "999000000000000000");
  });

  it("refuses a refreshed BLOCKED preview without building any action", async () => {
    vi.mocked(buildPreview).mockResolvedValue({ ...preview(), state: "BLOCKED", reasons: ["BLOCK_EXPOSURE_POLICY"] });
    expect(await buildRoutePreflight(intent)).toMatchObject({ kind: "refusal", routePolicy: "BLOCKED" });
    expect(buildSwapTransaction).not.toHaveBeenCalled();
    expect(buildVenusDeposit).not.toHaveBeenCalled();
  });

  it("refreshes both live quotes after a stale Binance quote ID", async () => {
    vi.mocked(buildSwapTransaction).mockRejectedValueOnce(new BinanceApiError("/api/v1/dex/aggregator/swap", 200, "40401", "Quote expired"));
    const result = await buildRoutePreflight(intent);
    expect(result.kind).toBe("preflight");
    expect(buildPreview).toHaveBeenCalledTimes(2);
    expect(buildSwapTransaction).toHaveBeenCalledTimes(4);
  });

  it("does not hide an unavailable build behind another leg's wallet-state failure", async () => {
    vi.mocked(simulateEvmTransaction).mockResolvedValue({ ...simulation, status: "BLOCKED_BY_WALLET_STATE", failReason: "insufficient allowance" });
    vi.mocked(buildVenusDeposit).mockRejectedValue(new Error("VENUS_BUILD_UNAVAILABLE"));
    const result = await buildRoutePreflight(intent);
    expect(result.kind).toBe("preflight");
    if (result.kind === "preflight") expect(result.overallPreflightState).toBe("UNAVAILABLE");
  });

  it("keeps a passing approval simulation separate from a swap blocked by current allowance", async () => {
    vi.mocked(buildSwapTransaction).mockImplementation(async quote => {
      const approval = validateEvmAction({ kind: "APPROVAL", chainId: 56, from: owner, to: quote.from, data: encodeExactApproval(target, quote.inputRaw), value: "0", valueFormat: "decimal-or-hex", tokenIn: quote.from, tokenOut: null, amountInRaw: quote.inputRaw, expectedFrom: owner });
      const swap = validateEvmAction({ kind: "SWAP", chainId: 56, from: owner, to: target, data: "0x12345678", value: "0", valueFormat: "decimal-or-hex", tokenIn: quote.from, tokenOut: quote.to, amountInRaw: quote.inputRaw, minAmountOutRaw: quote.outputRaw, expectedFrom: owner });
      return { executionMode: "SWAP", actions: [{ ...approval, authorization: reviewApproval({ token: quote.from, spender: target, requestedAmountRaw: quote.inputRaw, allowedAmountRaw: quote.inputRaw, decimals: 18, source: "BINANCE" }) }, swap],
        evmTx: { from: owner, to: target, value: "0", data: "0x12345678" }, minReceiveRaw: quote.leg === 1 ? "199900000000000000000" : "998000000000000000", quoteOutputRaw: quote.outputRaw };
    });
    vi.mocked(simulateEvmTransaction).mockImplementation(async tx => tx.to === target
      ? { ...simulation, status: "BLOCKED_BY_WALLET_STATE", failReason: "execution reverted: ERC20: insufficient allowance" }
      : simulation);
    const result = await buildRoutePreflight(intent);
    expect(result.kind).toBe("preflight");
    if (result.kind !== "preflight") return;
    expect(result.leg1.actions[0].simulation.status).toBe("PASSED");
    expect(result.leg1.actions[1].simulation.status).toBe("BLOCKED_BY_WALLET_STATE");
    expect(result.leg1.simulationPrerequisite).toBe("REQUIRES_PRIOR_APPROVAL_STATE");
    expect(result.overallPreflightState).toBe("WALLET_STATE_BLOCKED");
    vi.mocked(simulateEvmTransaction).mockImplementation(async tx => tx.to === target
      ? { ...simulation, status: "BLOCKED_BY_WALLET_STATE", failReason: "execution reverted: ERC20: insufficient allowance" }
      : { ...simulation, status: "FAILED", failReason: "unknown approval revert" });
    const failedApproval = await buildRoutePreflight(intent);
    if (failedApproval.kind !== "preflight") throw new Error("Expected preflight");
    expect(failedApproval.leg1.actions[0].simulation.status).toBe("FAILED");
    expect(failedApproval.overallPreflightState).toBe("BLOCKED");
  });
});
