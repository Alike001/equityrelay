import { describe, expect, it } from "vitest";
import { decodeApprovalCalldata, derivePerLegSlippagePercent, isWalletStateFailure, parseApprovalSignatureData, parseSimulation, parseUnsignedValue, validateEvmAction, validateQuoteForBuild } from "./validate";
import { NVDAON_ADDRESS, NVDAB_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import type { QuoteSnapshot, RouteDecision } from "@/types/route";

const owner = "0x1111111111111111111111111111111111111111" as const;
const router = "0x2222222222222222222222222222222222222222" as const;
const calldata = "0x12345678";
const swap = () => ({ kind: "SWAP" as const, chainId: 56, from: owner, to: router, data: calldata, value: "0", valueFormat: "decimal-or-hex" as const, tokenIn: NVDAON_ADDRESS, tokenOut: USDT_ADDRESS, amountInRaw: "100", minAmountOutRaw: "99", expectedFrom: owner });
const approveData = (spender = router, amount = 100n) => `0x095ea7b3${spender.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;

describe("unsigned transaction validation", () => {
  it("accepts an exact BSC ERC-20 swap and preserves the minimum receive", () => {
    expect(validateEvmAction(swap())).toMatchObject({ kind: "SWAP", chainId: 56, to: router, valueWei: "0", minAmountOutRaw: "99" });
  });
  it("rejects wrong chain, from, zero/invalid target, malformed calldata and unexpected native value", () => {
    for (const patch of [
      { chainId: 1 }, { from: router }, { to: "0x0000000000000000000000000000000000000000" },
      { to: "bad" }, { data: "0x123" }, { value: "1" },
    ]) expect(() => validateEvmAction({ ...swap(), ...patch })).toThrow();
  });
  it("requires a positive minimum receive for a swap", () => {
    expect(() => validateEvmAction({ ...swap(), minAmountOutRaw: undefined })).toThrow("MISSING_MIN_RECEIVE");
    expect(() => validateEvmAction({ ...swap(), minAmountOutRaw: "0" })).toThrow("MISSING_MIN_RECEIVE");
  });
  it("parses hex native value separately from decimal gas fields", () => {
    expect(parseUnsignedValue("0x0", "hex")).toBe("0");
    expect(validateEvmAction({ ...swap(), value: "0x0", valueFormat: "hex", gasLimit: "74142", maxFeePerGas: "57014496" })).toMatchObject({ valueWei: "0", gasLimit: "74142", maxFeePerGas: "57014496" });
    expect(() => validateEvmAction({ ...swap(), value: "0x0", valueFormat: "hex", gasLimit: "0x74142" })).toThrow("INVALID_GAS_FIELD");
  });
  it("parses documented approval JSON and validates encoded spender and amount", () => {
    const data = approveData();
    expect(parseApprovalSignatureData([JSON.stringify({ approveContract: router, approveTxCalldata: data })], NVDAON_ADDRESS, owner, "100")[0]).toMatchObject({ kind: "APPROVAL", to: NVDAON_ADDRESS, approvalSpender: router, approvalAmountRaw: "100", approvalExceedsInput: false });
    expect(() => parseApprovalSignatureData([router], NVDAON_ADDRESS, owner, "100")).toThrow("UNSUPPORTED_APPROVAL_FORMAT");
    expect(() => parseApprovalSignatureData([JSON.stringify({ approveContract: owner, approveTxCalldata: data })], NVDAON_ADDRESS, owner, "100")).toThrow("APPROVAL_SPENDER_MISMATCH");
    expect(() => parseApprovalSignatureData([JSON.stringify({ approveContract: router, approveTxCalldata: approveData(router, 101n) })], NVDAON_ADDRESS, owner, "100")).toThrow("APPROVAL_AMOUNT_EXCEEDS_INPUT");
    expect(decodeApprovalCalldata(approveData(router, 101n), "100", true).exceedsInput).toBe(true);
  });
  it("recognizes only evidenced wallet-state failures", () => {
    expect(isWalletStateFailure("execution reverted: ERC20: insufficient allowance")).toBe(true);
    expect(isWalletStateFailure("BEP20: transfer amount exceeds balance")).toBe(true);
    expect(isWalletStateFailure("execution reverted: unknown selector")).toBe(false);
  });
  it("requires success status and no contradictory failure reason", () => {
    expect(parseSimulation({ status: "SUCCESS" }).status).toBe("PASSED");
    expect(parseSimulation({ status: "FAILED", failReason: "insufficient balance" }).status).toBe("BLOCKED_BY_WALLET_STATE");
    expect(parseSimulation({ status: "FAILED", failReason: "unknown revert" }).status).toBe("FAILED");
    expect(parseSimulation({ status: "SUCCESS", failReason: "unknown revert" }).status).toBe("FAILED");
  });
  it("rejects missing and stale quote IDs before a build", () => {
    const quote: QuoteSnapshot = { leg: 1, from: NVDAON_ADDRESS, to: USDT_ADDRESS, inputRaw: "100", outputRaw: "99", vendor: null, quoteId: null, tradeFeeUsd: null, priceImpactPercent: null, observedAt: new Date().toISOString(), expiresAt: null };
    expect(() => validateQuoteForBuild(quote)).toThrow("MISSING_QUOTE_ID");
    expect(() => validateQuoteForBuild({ ...quote, quoteId: "id", observedAt: new Date(Date.now() - 26000).toISOString() })).toThrow("QUOTE_TOO_OLD_FOR_BUILD");
    expect(() => validateQuoteForBuild({ ...quote, quoteId: "id", expiresAt: new Date(Date.now() - 1000).toISOString() })).toThrow("QUOTE_EXPIRED");
  });
  it("derives a conservative per-leg slippage cap from remaining policy budget", () => {
    const cap = derivePerLegSlippagePercent({ retentionPercent: "99.92", maxExposureLossBps: 50 } as RouteDecision);
    expect(Number(cap)).toBeGreaterThan(0);
    expect(Number(cap)).toBeLessThan(0.25);
    expect(derivePerLegSlippagePercent({ retentionPercent: "99.5", maxExposureLossBps: 50 } as RouteDecision)).toBe("0.000000");
    expect(() => derivePerLegSlippagePercent({ retentionPercent: "99.4", maxExposureLossBps: 50 } as RouteDecision)).toThrow();
  });
  it("keeps source and target token identities on each action", () => {
    expect(validateEvmAction({ ...swap(), tokenIn: NVDAON_ADDRESS, tokenOut: NVDAB_ADDRESS }).tokenIn).toBe(NVDAON_ADDRESS);
  });
});
