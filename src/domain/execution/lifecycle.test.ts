import { describe, expect, it } from "vitest";
import { reviewApproval } from "@/domain/authorization/approval";
import { NVDAB_ADDRESS, NVDAON_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import type { Address, QuoteSnapshot, RouteDecision } from "@/types/route";
import type { ConfirmedTransaction, ExecutionReview, ExecutionSession } from "@/types/execution";
import type { PreflightAction } from "@/types/preflight";
import { beginExecutionSession, measureSettlement, observeTransaction, prepareReview, recordConfirmation, rediscoverVenus, recheckPolicy, requoteLeg2, submitPlannedAction, verifyExecutionReceipt } from "./lifecycle";
import { deriveSettlement } from "./settlement";

const owner = "0x1111111111111111111111111111111111111111" as Address;
const router = "0x2222222222222222222222222222222222222222" as Address;
const venus = "0x3333333333333333333333333333333333333333" as Address;
const oldTime = "2026-09-29T18:00:00.000Z";
const confirmedTime = "2026-09-29T18:01:00.000Z";
const freshTime = "2026-09-29T18:02:00.000Z";
const one = "1000000000000000000";
const actualUsdt = "199000000000000000000";
const actualNvdab = "997000000000000000";
const hash = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const simulation = { status: "BLOCKED_BY_WALLET_STATE" as const, failReason: "current allowance", balanceChanges: [], allowanceChanges: [], warnings: [] };
function approval(token: Address, amount: string, spender = router) { return reviewApproval({ token, spender, requestedAmountRaw: amount, allowedAmountRaw: amount, decimals: 18, source: "BINANCE" }); }
function quote(leg: 1 | 2, from: Address, to: Address, inputRaw: string, outputRaw: string, quoteId: string, observedAt = oldTime): QuoteSnapshot {
  return { leg, from, to, inputRaw, outputRaw, quoteId, observedAt, expiresAt: null, vendor: null, tradeFeeUsd: null, priceImpactPercent: null, inputDecimals: 18, outputDecimals: 18 };
}
function preview(): RouteDecision {
  return { kind: "decision", state: "PASS", reasons: ["PASS_ROUTE_READY"], amount: "1", maxExposureLossBps: 50, sourceShares: "1", targetShares: "0.999", retentionPercent: "99.9", exposureLossPercent: "0.1", observedAt: oldTime, expiresAt: null,
    evidence: { sourceRaw: one,
      source: { chainId: 56, underlying: "NVDA", issuer: "ondo", symbol: "NVDAon", address: NVDAON_ADDRESS, decimals: 18, tokenToShareRatio: "1", open: true, observedAt: oldTime },
      target: { chainId: 56, underlying: "NVDA", issuer: "bstock", symbol: "NVDAB", address: NVDAB_ADDRESS, decimals: 18, tokenToShareRatio: "1", open: true, observedAt: oldTime },
      destination: { chainId: 56, protocol: "Venus", investmentId: "old", assetAddress: NVDAB_ADDRESS, investable: true, observedAt: oldTime },
      leg1: quote(1, NVDAON_ADDRESS, USDT_ADDRESS, one, "200000000000000000000", "old-first"),
      leg2: quote(2, USDT_ADDRESS, NVDAB_ADDRESS, "200000000000000000000", "999000000000000000", "old-second") } };
}
function action(kind: "SWAP" | "DEPOSIT", tokenIn: Address, tokenOut: Address | null, input: string, minOut: string | null, to = router): PreflightAction {
  return { kind, chainId: 56, from: owner, to, valueWei: "0", rawCalldata: "0x12345678", calldataSummary: "test action", gasLimit: "450000", gasPrice: "1000000000", maxPriorityFeePerGas: null, maxFeePerGas: null,
    tokenIn, tokenOut, amountInRaw: input, minAmountOutRaw: minOut, amountInHuman: null, minAmountOutHuman: null, slippagePercent: null, tokenInLabel: "", tokenOutLabel: null,
    approvalSpender: null, approvalAmountRaw: null, approvalExceedsInput: false, authorization: null, simulation, simulationPrerequisite: "SIMULATABLE_NOW" };
}
function review(boundary: ExecutionReview["boundary"], input: string, quoteValue: QuoteSnapshot | null, allowanceSufficient = false): ExecutionReview {
  const token = boundary === "LEAVE_ONDO" ? NVDAON_ADDRESS : boundary === "CHANGE_REPRESENTATION" ? USDT_ADDRESS : NVDAB_ADDRESS;
  return { boundary, approval: allowanceSufficient ? null : approval(token, input, boundary === "SUPPLY_TO_VENUS" ? venus : router), allowanceSufficient,
    action: boundary === "SUPPLY_TO_VENUS" ? action("DEPOSIT", token, null, input, null, venus) : action("SWAP", token, boundary === "LEAVE_ONDO" ? USDT_ADDRESS : NVDAB_ADDRESS, input, quoteValue!.outputRaw),
    simulation: "BLOCKED_BY_WALLET_STATE", createdAt: freshTime, quote: quoteValue, destination: boundary === "SUPPLY_TO_VENUS" ? { chainId: 56, protocol: "Venus", investmentId: "fresh", assetAddress: NVDAB_ADDRESS, investable: true, observedAt: freshTime } : null };
}
function receipt(number: string, target: Address, inputToken: Address, input: string, outputToken: Address, output: string): ConfirmedTransaction {
  return { status: "CONFIRMED", transactionHash: hash(number), blockNumber: "123", from: owner, to: target, confirmedAt: confirmedTime, tokenTransfers: [
    { token: inputToken, from: owner, to: target, amountRaw: input, logIndex: 0 }, { token: outputToken, from: target, to: owner, amountRaw: output, logIndex: 1 } ] };
}
function start() { return beginExecutionSession("opaque", owner, preview()); }
function leg1Confirmed(): ExecutionSession {
  let state = prepareReview(start(), review("LEAVE_ONDO", one, preview().evidence.leg1));
  state = recordConfirmation(state, "LEAVE_ONDO");
  state = submitPlannedAction(state, "LEAVE_ONDO", "APPROVAL", { status: "SUBMITTED", transactionHash: hash("a") });
  state = observeTransaction(state, "LEAVE_ONDO", "APPROVAL", { status: "CONFIRMED", transactionHash: hash("a"), blockNumber: "120", from: owner, to: NVDAON_ADDRESS, tokenTransfers: [], confirmedAt: confirmedTime });
  state = submitPlannedAction(state, "LEAVE_ONDO", "SWAP", { status: "SUBMITTED", transactionHash: hash("1") });
  state = observeTransaction(state, "LEAVE_ONDO", "SWAP", receipt("1", router, NVDAON_ADDRESS, one, USDT_ADDRESS, actualUsdt));
  return state;
}
function settledLeg1() { return measureSettlement(leg1Confirmed(), "LEG1", deriveSettlement(receipt("1", router, NVDAON_ADDRESS, one, USDT_ADDRESS, actualUsdt), owner, NVDAON_ADDRESS, USDT_ADDRESS)); }
function freshLeg2(output = "998000000000000000") { return quote(2, USDT_ADDRESS, NVDAB_ADDRESS, actualUsdt, output, "fresh-second", freshTime); }

describe("Phase 3A execution boundaries", () => {
  it("requires confirmation and confirmed approval before the first swap", () => {
    const reviewed = prepareReview(start(), review("LEAVE_ONDO", one, preview().evidence.leg1));
    expect(() => submitPlannedAction(reviewed, "LEAVE_ONDO", "SWAP", { status: "SUBMITTED", transactionHash: hash("1") })).toThrow("CONFIRMED_USER_ACTION_REQUIRED");
    const confirmed = recordConfirmation(reviewed, "LEAVE_ONDO");
    expect(() => submitPlannedAction(confirmed, "LEAVE_ONDO", "SWAP", { status: "SUBMITTED", transactionHash: hash("1") })).toThrow("INVALID_EXECUTION_TRANSITION");
    expect(() => prepareReview(start(), { ...review("LEAVE_ONDO", one, preview().evidence.leg1), approval: approval(NVDAON_ADDRESS, "999999999999999999999") })).toThrow("AUTHORIZATION_NOT_BOUNDED");
  });
  it("allows an already sufficient allowance without another approval", () => {
    let state = recordConfirmation(prepareReview(start(), review("LEAVE_ONDO", one, preview().evidence.leg1, true)), "LEAVE_ONDO");
    expect(() => submitPlannedAction(state, "LEAVE_ONDO", "APPROVAL", { status: "SUBMITTED", transactionHash: hash("a") })).toThrow("APPROVAL_NOT_REQUIRED");
    state = submitPlannedAction(state, "LEAVE_ONDO", "SWAP", { status: "SUBMITTED", transactionHash: hash("1") });
    expect(state.stage).toBe("LEG1_SWAP_PENDING");
  });
  it("a hash or pending receipt cannot confirm a swap; failure ends the route", () => {
    const state = leg1Confirmed();
    expect(state.stage).toBe("LEG1_CONFIRMED");
    let pending = submitPlannedAction(recordConfirmation(prepareReview(start(), review("LEAVE_ONDO", one, preview().evidence.leg1, true)), "LEAVE_ONDO"), "LEAVE_ONDO", "SWAP", { status: "SUBMITTED", transactionHash: hash("1") });
    pending = observeTransaction(pending, "LEAVE_ONDO", "SWAP", { status: "PENDING", transactionHash: hash("1") });
    expect(pending.stage).toBe("LEG1_SWAP_PENDING");
    const failed = observeTransaction(pending, "LEAVE_ONDO", "SWAP", { status: "FAILED", transactionHash: hash("1"), reason: "reverted" });
    expect(failed.stage).toBe("FAILED");
    expect(() => requoteLeg2(failed, freshLeg2(), preview().evidence.target)).toThrow("INVALID_EXECUTION_TRANSITION");
  });
  it("uses actual USDT, rejects old quote, and stops without rollback on policy failure", () => {
    const state = settledLeg1();
    expect(state.leg1Settlement?.actualAmountOutRaw).toBe(actualUsdt);
    expect(() => requoteLeg2(state, preview().evidence.leg2, preview().evidence.target)).toThrow("FRESH_SETTLED_LEG2_QUOTE_REQUIRED");
    expect(() => requoteLeg2(state, { ...freshLeg2(), inputRaw: preview().evidence.leg2.inputRaw }, preview().evidence.target)).toThrow("FRESH_SETTLED_LEG2_QUOTE_REQUIRED");
    const stopped = recheckPolicy(requoteLeg2(state, freshLeg2("990000000000000000"), preview().evidence.target));
    expect(stopped).toMatchObject({ stage: "PARTIAL_ROUTE_STOPPED", policyRecheck: "PARTIAL_ROUTE_STOPPED" });
    expect(stopped.leg1Settlement?.actualAmountOutRaw).toBe(actualUsdt);
    expect(() => prepareReview(stopped, review("CHANGE_REPRESENTATION", actualUsdt, freshLeg2()))).toThrow("INVALID_EXECUTION_TRANSITION");
  });
  it("requires confirmed leg 2 and actual NVDAB before a fresh Venus review", () => {
    let state = recheckPolicy(requoteLeg2(settledLeg1(), freshLeg2(), preview().evidence.target));
    expect(state.policyRecheck).toBe("PASS");
    expect(() => prepareReview(state, review("CHANGE_REPRESENTATION", preview().evidence.leg2.inputRaw, freshLeg2()))).toThrow("INVALID_EXECUTION_REVIEW");
    state = recordConfirmation(prepareReview(state, review("CHANGE_REPRESENTATION", actualUsdt, freshLeg2())), "CHANGE_REPRESENTATION");
    state = submitPlannedAction(state, "CHANGE_REPRESENTATION", "APPROVAL", { status: "SUBMITTED", transactionHash: hash("b") });
    state = observeTransaction(state, "CHANGE_REPRESENTATION", "APPROVAL", { status: "CONFIRMED", transactionHash: hash("b"), blockNumber: "122", from: owner, to: USDT_ADDRESS, tokenTransfers: [], confirmedAt: confirmedTime });
    state = submitPlannedAction(state, "CHANGE_REPRESENTATION", "SWAP", { status: "SUBMITTED", transactionHash: hash("2") });
    expect(() => rediscoverVenus(state, review("SUPPLY_TO_VENUS", actualNvdab, null).destination!)).toThrow("INVALID_EXECUTION_TRANSITION");
    state = observeTransaction(state, "CHANGE_REPRESENTATION", "SWAP", receipt("2", router, USDT_ADDRESS, actualUsdt, NVDAB_ADDRESS, actualNvdab));
    state = measureSettlement(state, "LEG2", deriveSettlement(receipt("2", router, USDT_ADDRESS, actualUsdt, NVDAB_ADDRESS, actualNvdab), owner, USDT_ADDRESS, NVDAB_ADDRESS));
    expect(() => rediscoverVenus(state, { ...review("SUPPLY_TO_VENUS", actualNvdab, null).destination!, investable: false })).toThrow("FRESH_VENUS_DISCOVERY_REQUIRED");
    state = rediscoverVenus(state, review("SUPPLY_TO_VENUS", actualNvdab, null).destination!);
    expect(() => prepareReview(state, review("SUPPLY_TO_VENUS", "998000000000000000", null))).toThrow("INVALID_EXECUTION_REVIEW");
    state = recordConfirmation(prepareReview(state, review("SUPPLY_TO_VENUS", actualNvdab, null)), "SUPPLY_TO_VENUS");
    state = submitPlannedAction(state, "SUPPLY_TO_VENUS", "APPROVAL", { status: "SUBMITTED", transactionHash: hash("c") });
    state = observeTransaction(state, "SUPPLY_TO_VENUS", "APPROVAL", { status: "CONFIRMED", transactionHash: hash("c"), blockNumber: "124", from: owner, to: NVDAB_ADDRESS, tokenTransfers: [], confirmedAt: confirmedTime });
    state = submitPlannedAction(state, "SUPPLY_TO_VENUS", "DEPOSIT", { status: "SUBMITTED", transactionHash: hash("3") });
    expect(() => verifyExecutionReceipt(state)).toThrow("INVALID_EXECUTION_TRANSITION");
    state = observeTransaction(state, "SUPPLY_TO_VENUS", "DEPOSIT", { status: "CONFIRMED", transactionHash: hash("3"), blockNumber: "125", from: owner, to: venus, tokenTransfers: [], confirmedAt: confirmedTime });
    const verified = verifyExecutionReceipt(state);
    expect(verified.status).toBe("VERIFIED");
    expect(verified.quoted.indicativeLeg2.outputRaw).toBe("999000000000000000");
    expect(verified.actual.leg2.actualAmountOutRaw).toBe(actualNvdab);
    expect(verified.actual.realizedRetentionPercent).toBe("99.7");
  });
});
