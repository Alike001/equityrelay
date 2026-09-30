import "server-only";
import { formatUnits } from "viem";
import { executionActionV1 } from "@/domain/execution/action";
import { prepareExitRecovery, prepareRedeemRecovery } from "@/domain/execution/recovery";
import { NVDAB_ADDRESS, USDT_ADDRESS, VENUS_VNVDAB_ADDRESS } from "@/domain/routing/identity";
import { discoverRepresentations } from "@/lib/binance/rwa";
import { discoverVenusInvestment } from "@/lib/binance/defi";
import { buildVenusRedeem } from "@/lib/binance/defi-redeem";
import { requestQuote } from "@/lib/binance/trading";
import { buildSwapTransaction } from "@/lib/binance/swap-build";
import { createServerReview } from "./review";
import { getExecutionRoute, persistPreparedReview } from "./repository";
import type { PreflightAction, SimulationResult } from "@/types/preflight";
import type { Address } from "@/types/route";

function redeemSimulation(status: "PASSED" | "BLOCKED_BY_WALLET_STATE" | "FAILED" | "UNAVAILABLE", reason: string | null, warnings: string[]): SimulationResult {
  return { status, failReason: reason, balanceChanges: [], allowanceChanges: [], warnings };
}

export async function prepareDurableRedeemReview(routeId: string, wallet: Address) {
  const stored = await getExecutionRoute(routeId, wallet);
  const recovery = stored?.session.recovery;
  if (!stored || !recovery || recovery.state !== "VENUS_POSITION_VERIFIED") throw new Error("VERIFIED_VENUS_POSITION_REQUIRED");
  const [destination, representations] = await Promise.all([discoverVenusInvestment(), discoverRepresentations()]);
  if (!destination?.investable || destination.investmentId !== recovery.venusPosition.investmentId) throw new Error("VENUS_REDISCOVERY_REQUIRED");
  const build = await buildVenusRedeem(wallet, destination, representations.target, recovery.venusPosition.underlyingAmountRaw,
    recovery.venusPosition.vTokenAmountRaw);
  if (build.buildStatus !== "READY" || build.functionName !== "redeem" || !build.target || !build.rawCalldata || !build.redeemVTokensRaw ||
      build.redeemVTokensRaw !== recovery.venusPosition.vTokenAmountRaw || !build.valueWei)
    throw new Error("VENUS_REDEEM_BUILD_UNAVAILABLE");
  const action: PreflightAction = { kind: "REDEEM", chainId: 56, from: wallet, to: build.target, valueWei: build.valueWei,
    calldataSummary: `${build.calldataSelector} · ${(build.rawCalldata.length - 2) / 2} bytes`, rawCalldata: build.rawCalldata,
    gasLimit: build.gasLimit, gasPrice: null, maxPriorityFeePerGas: build.maxPriorityFeePerGas, maxFeePerGas: build.maxFeePerGas,
    tokenIn: VENUS_VNVDAB_ADDRESS, tokenOut: NVDAB_ADDRESS, amountInRaw: build.redeemVTokensRaw,
    minAmountOutRaw: null, amountInHuman: formatUnits(BigInt(build.redeemVTokensRaw), 8), minAmountOutHuman: null,
    slippagePercent: null, tokenInLabel: "vNVDAB", tokenOutLabel: "NVDAB", approvalSpender: null, approvalAmountRaw: null,
    approvalExceedsInput: false, authorization: null,
    simulation: redeemSimulation(build.simulationStatus, build.reason, build.preview?.warnings ?? []), simulationPrerequisite: "REQUIRES_CURRENT_BALANCE" };
  const semantic = executionActionV1({ routeId, stage: "VENUS_REDEEM", action, planIdentity: destination.investmentId });
  const review = await createServerReview({ boundary: "REDEEM_VENUS", owner: wallet, action, approval: null, quote: null, destination });
  const session = { ...prepareRedeemRecovery(stored.session, semantic, build.expectedUnderlyingOutRaw),
    reviews: { ...stored.session.reviews, REDEEM_VENUS: review } };
  const step = await persistPreparedReview(routeId, wallet, stored.version, session, semantic,
    { gas: { gasLimit: build.gasLimit, maxFeePerGas: build.maxFeePerGas, maxPriorityFeePerGas: build.maxPriorityFeePerGas } });
  return { state: "REDEEM_REVIEW_READY" as const, stepId: step.id, stage: step.stage, actionHash: step.actionHash,
    expectedUnderlyingRaw: build.expectedUnderlyingOutRaw, executionArmed: false };
}

function exitSlippage(): string {
  const value = process.env.EQUITYRELAY_EXIT_SLIPPAGE_PERCENT ?? "0.5";
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || Number(value) > 1) throw new Error("INVALID_EXIT_SLIPPAGE_POLICY");
  return value;
}

export async function prepareDurableExitReview(routeId: string, wallet: Address) {
  const stored = await getExecutionRoute(routeId, wallet);
  const recovery = stored?.session.recovery;
  if (!stored || !recovery || recovery.state !== "ACTUAL_NVDAB_REDEEMED" || !recovery.redeemSettlement)
    throw new Error("ACTUAL_REDEEMED_NVDAB_REQUIRED");
  const quote = await requestQuote(2, NVDAB_ADDRESS, USDT_ADDRESS, recovery.redeemSettlement.actualAmountOutRaw, wallet);
  if (!quote?.quoteId || Date.parse(quote.observedAt) <= Date.parse(recovery.redeemSettlement.confirmedAt)) throw new Error("FRESH_EXIT_QUOTE_REQUIRED");
  const build = await buildSwapTransaction(quote, wallet, exitSlippage());
  if (!build.evmTx) throw new Error("EXIT_RFQ_UNSUPPORTED");
  const swap = build.actions.find(action => action.kind === "SWAP"), approval = build.actions.find(action => action.kind === "APPROVAL");
  if (!swap) throw new Error("EXIT_BUILD_UNAVAILABLE");
  const labeledSwap = { ...swap, tokenInLabel: "NVDAB", tokenOutLabel: "USDT" };
  const review = await createServerReview({ boundary: "EXIT_TO_USDT", owner: wallet, action: labeledSwap,
    approval: approval?.authorization ?? null, quote, destination: null });
  const nextAction = !review.allowanceSufficient && approval ? { ...approval, tokenInLabel: "NVDAB" } : labeledSwap;
  const stage = nextAction.kind === "APPROVAL" ? "EXIT_APPROVAL" : "EXIT_SWAP";
  const semantic = executionActionV1({ routeId, stage, action: nextAction, planIdentity: quote.quoteId });
  const session = { ...prepareExitRecovery(stored.session, quote, semantic), reviews: { ...stored.session.reviews, EXIT_TO_USDT: review } };
  const step = await persistPreparedReview(routeId, wallet, stored.version, session, semantic,
    { quote: { quoteId: quote.quoteId, observedAt: quote.observedAt, expiresAt: quote.expiresAt, inputRaw: quote.inputRaw },
      authorization: nextAction.authorization, gas: { gasLimit: nextAction.gasLimit, gasPrice: nextAction.gasPrice,
        maxFeePerGas: nextAction.maxFeePerGas, maxPriorityFeePerGas: nextAction.maxPriorityFeePerGas } });
  return { state: "EXIT_REVIEW_READY" as const, stepId: step.id, stage, actionHash: step.actionHash,
    amountInRaw: quote.inputRaw, expectedOutputRaw: quote.outputRaw, executionArmed: false };
}
