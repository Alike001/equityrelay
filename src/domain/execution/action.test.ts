import { describe, expect, it } from "vitest";
import { encodeExactApproval, reviewApproval } from "@/domain/authorization/approval";
import { NVDAB_ADDRESS, NVDAON_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import type { PreflightAction } from "@/types/preflight";
import type { Address } from "@/types/route";
import { executionActionHash, executionActionV1, matchTransactionSemantics } from "./action";

const wallet = "0x1111111111111111111111111111111111111111" as Address;
const router = "0x2222222222222222222222222222222222222222" as Address;
const simulation = { status: "UNAVAILABLE" as const, failReason: null, balanceChanges: [], allowanceChanges: [], warnings: [] };
function swap(): PreflightAction {
  return { kind: "SWAP", chainId: 56, from: wallet, to: router, valueWei: "0", rawCalldata: "0x12345678", calldataSummary: "swap",
    gasLimit: "400000", gasPrice: "1000000000", maxPriorityFeePerGas: null, maxFeePerGas: null,
    tokenIn: NVDAON_ADDRESS, tokenOut: USDT_ADDRESS, amountInRaw: "50000000000000000", minAmountOutRaw: "10000000",
    amountInHuman: "0.05", minAmountOutHuman: "10", slippagePercent: null, tokenInLabel: "NVDAon", tokenOutLabel: "USDT",
    approvalSpender: null, approvalAmountRaw: null, approvalExceedsInput: false, authorization: null, simulation,
    simulationPrerequisite: "REQUIRES_PRIOR_APPROVAL_STATE" };
}
function approval(): PreflightAction {
  const base = swap(), amount = base.amountInRaw;
  return { ...base, kind: "APPROVAL", to: NVDAON_ADDRESS, rawCalldata: encodeExactApproval(router, amount), tokenOut: null,
    authorization: reviewApproval({ token: NVDAON_ADDRESS, spender: router, requestedAmountRaw: amount,
      allowedAmountRaw: amount, decimals: 18, source: "BINANCE" }) };
}
const make = (action: PreflightAction, stage: "LEG1_SWAP" | "LEG1_APPROVAL" = "LEG1_SWAP") =>
  executionActionV1({ routeId: "route-1", stage, action, planIdentity: "quote-1" });

describe("versioned semantic action", () => {
  it("ignores recommended gas but binds route and quote", () => {
    const base = swap();
    expect(executionActionHash(make(base))).toBe(executionActionHash(make({ ...base, gasLimit: "500000", gasPrice: "2000000000" })));
    expect(executionActionHash(make(base))).not.toBe(executionActionHash(executionActionV1({ routeId: "route-2", stage: "LEG1_SWAP", action: base, planIdentity: "quote-1" })));
    expect(executionActionHash(make(base))).not.toBe(executionActionHash(executionActionV1({ routeId: "route-1", stage: "LEG1_SWAP", action: base, planIdentity: "quote-2" })));
  });
  it.each(["to", "rawCalldata", "valueWei"] as const)("rejects or changes altered %s", field => {
    const base = swap();
    const modified = { ...base, [field]: field === "to" ? NVDAB_ADDRESS : field === "rawCalldata" ? "0xabcdef12" : "1" };
    if (field === "valueWei") expect(() => make(modified)).toThrow("UNEXPECTED_NATIVE_VALUE");
    else expect(executionActionHash(make(modified))).not.toBe(executionActionHash(make(base)));
  });
  it("decodes exact approval and rejects broad, wrong spender, and wrong token", () => {
    const exact = make(approval(), "LEG1_APPROVAL");
    expect(exact.approvalAmountRaw).toBe("50000000000000000");
    expect(exact.approvalSpender).toBe(router);
    expect(() => make({ ...approval(), rawCalldata: encodeExactApproval(router, "50000000000000001") }, "LEG1_APPROVAL")).toThrow("AUTHORIZATION_NOT_BOUNDED");
    expect(() => make({ ...approval(), rawCalldata: encodeExactApproval(wallet, "50000000000000000") }, "LEG1_APPROVAL")).toThrow("AUTHORIZATION_NOT_BOUNDED");
    expect(() => make({ ...approval(), to: USDT_ADDRESS }, "LEG1_APPROVAL")).toThrow("AUTHORIZATION_NOT_BOUNDED");
  });
  it("changes when a valid plan changes approval spender or exact amount", () => {
    const first = approval();
    const alternateSpender = "0x3333333333333333333333333333333333333333" as Address;
    const spenderChanged = { ...first, rawCalldata: encodeExactApproval(alternateSpender, first.amountInRaw),
      authorization: reviewApproval({ token: NVDAON_ADDRESS, spender: alternateSpender, requestedAmountRaw: first.amountInRaw,
        allowedAmountRaw: first.amountInRaw, decimals: 18, source: "BINANCE" }) };
    const amount = "40000000000000000";
    const amountChanged = { ...first, amountInRaw: amount, rawCalldata: encodeExactApproval(router, amount),
      authorization: reviewApproval({ token: NVDAON_ADDRESS, spender: router, requestedAmountRaw: amount,
        allowedAmountRaw: amount, decimals: 18, source: "BINANCE" }) };
    expect(executionActionHash(make(first, "LEG1_APPROVAL"))).not.toBe(executionActionHash(make(spenderChanged, "LEG1_APPROVAL")));
    expect(executionActionHash(make(first, "LEG1_APPROVAL"))).not.toBe(executionActionHash(make(amountChanged, "LEG1_APPROVAL")));
  });
  it("matches canonical semantics regardless of wallet nonce or gas", () => {
    const action = make(swap());
    expect(() => matchTransactionSemantics(action, { from: wallet, to: router, input: action.data, value: 0n, chainId: 56 })).not.toThrow();
    expect(() => matchTransactionSemantics(action, { from: wallet, to: router, input: "0xabcdef12", value: 0n, chainId: 56 })).toThrow("CANONICAL_ACTION_MISMATCH");
    expect(() => matchTransactionSemantics(action, { from: wallet, to: USDT_ADDRESS, input: action.data, value: 0n, chainId: 56 })).toThrow("CANONICAL_ACTION_MISMATCH");
    expect(() => matchTransactionSemantics(action, { from: wallet, to: router, input: action.data, value: 1n, chainId: 56 })).toThrow("CANONICAL_ACTION_MISMATCH");
    expect(() => matchTransactionSemantics(action, { from: wallet, to: router, input: action.data, value: 0n, chainId: 1 })).toThrow("CANONICAL_ACTION_MISMATCH");
  });
});
