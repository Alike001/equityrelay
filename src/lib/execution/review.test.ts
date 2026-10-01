import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const allowanceMocks = vi.hoisted(() => ({ read: vi.fn(), covers: vi.fn() }));
vi.mock("./allowance", () => ({
  readCurrentAllowance: allowanceMocks.read,
  allowanceCovers: allowanceMocks.covers,
}));

import { equityConfig, SUPPORTED_UNDERLYINGS } from "@/domain/equities/registry";
import { createServerReview } from "./review";
import type { PreflightAction } from "@/types/preflight";

const owner = "0x1111111111111111111111111111111111111111" as const;

describe("live allowance authority for validated Venus markets", () => {
  beforeEach(() => {
    allowanceMocks.read.mockReset().mockResolvedValue("0");
    allowanceMocks.covers.mockReset().mockReturnValue(false);
  });

  it.each(SUPPORTED_UNDERLYINGS)("does not treat missing %s approval metadata as sufficient allowance", async underlying => {
    const config = equityConfig(underlying);
    const action: PreflightAction = {
      kind: "DEPOSIT", chainId: 56, from: owner, to: config.venusMarketAddress, valueWei: "0",
      calldataSummary: "mint", rawCalldata: "0x12345678", gasLimit: null, gasPrice: null,
      maxPriorityFeePerGas: null, maxFeePerGas: null, tokenIn: config.targetAddress, tokenOut: null,
      amountInRaw: "100", minAmountOutRaw: null, amountInHuman: "0.0000000000000001",
      minAmountOutHuman: null, slippagePercent: null, tokenInLabel: config.targetSymbol,
      tokenOutLabel: "Venus", approvalSpender: null, approvalAmountRaw: null,
      approvalExceedsInput: false, authorization: null,
      simulation: { status: "UNAVAILABLE", failReason: null, balanceChanges: [], allowanceChanges: [], warnings: [] },
      simulationPrerequisite: "REQUIRES_CURRENT_BALANCE",
    };
    const destination = { chainId: 56 as const, protocol: "Venus" as const, investmentId: `${underlying}-live`,
      assetAddress: config.targetAddress, investable: true, observedAt: new Date().toISOString() };
    await expect(createServerReview({ boundary: "SUPPLY_TO_VENUS", owner, action, approval: null,
      quote: null, destination })).rejects.toThrow("BOUNDED_APPROVAL_REQUIRED");
    expect(allowanceMocks.read).toHaveBeenCalledWith(config.targetAddress, owner, config.venusMarketAddress);
  });

  it.each(SUPPORTED_UNDERLYINGS)("skips a redundant %s approval only after live allowance covers the amount", async underlying => {
    allowanceMocks.read.mockResolvedValue("100");
    allowanceMocks.covers.mockReturnValue(true);
    const config = equityConfig(underlying);
    const action = { kind: "DEPOSIT", chainId: 56, from: owner, to: config.venusMarketAddress, valueWei: "0",
      calldataSummary: "mint", rawCalldata: "0x12345678", gasLimit: null, gasPrice: null,
      maxPriorityFeePerGas: null, maxFeePerGas: null, tokenIn: config.targetAddress, tokenOut: null,
      amountInRaw: "100", minAmountOutRaw: null, amountInHuman: "0.0000000000000001", minAmountOutHuman: null,
      slippagePercent: null, tokenInLabel: config.targetSymbol, tokenOutLabel: "Venus", approvalSpender: null,
      approvalAmountRaw: null, approvalExceedsInput: false, authorization: null,
      simulation: { status: "UNAVAILABLE" as const, failReason: null, balanceChanges: [], allowanceChanges: [], warnings: [] },
      simulationPrerequisite: "REQUIRES_CURRENT_BALANCE" as const } satisfies PreflightAction;
    const destination = { chainId: 56 as const, protocol: "Venus" as const, investmentId: `${underlying}-live`,
      assetAddress: config.targetAddress, investable: true, observedAt: new Date().toISOString() };
    await expect(createServerReview({ boundary: "SUPPLY_TO_VENUS", owner, action, approval: null,
      quote: null, destination })).resolves.toMatchObject({ allowanceSufficient: true, approval: null });
  });
});
