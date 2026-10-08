import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, erc20Abi } from "viem";
import type { PreflightAction } from "@/types/preflight";

const mocks = vi.hoisted(() => ({ chain: vi.fn(), estimate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./rpc", () => ({ bscPublicClient: () => ({ getChainId:mocks.chain,estimateGas:mocks.estimate }),
  readBscWithRetry: (read: () => Promise<unknown>) => read() }));
import { APPROVAL_GAS_BUFFER_BPS, ensureApprovalGasLimit } from "./approval-gas";

const owner = "0x1111111111111111111111111111111111111111" as const;
const token = "0x55d398326f99059ff775485246999027b3197955" as const;
const spender = "0x2222222222222222222222222222222222222222" as const;
function approval(gasLimit: string | null): PreflightAction {
  return { kind:"APPROVAL",chainId:56,from:owner,to:token,valueWei:"0",rawCalldata:encodeFunctionData({ abi:erc20Abi,
    functionName:"approve",args:[spender,5n] }),calldataSummary:"approve exact amount",gasLimit,gasPrice:null,maxPriorityFeePerGas:null,
    maxFeePerGas:null,tokenIn:token,tokenOut:null,amountInRaw:"5",minAmountOutRaw:null,amountInHuman:"0.000000000000000005",
    minAmountOutHuman:null,slippagePercent:null,tokenInLabel:"USDT",tokenOutLabel:null,approvalSpender:spender,approvalAmountRaw:"5",
    approvalExceedsInput:false,authorization:{ token,spender,requestedAmountRaw:"5",allowedAmountRaw:"5",requestedAmountHuman:"0.000000000000000005",
      allowedAmountHuman:"0.000000000000000005",scope:"EXACT",source:"BINANCE",status:"BOUNDED_READY",reasonCodes:["APPROVAL_EXACT_AMOUNT"] },
    simulation:{ status:"PASSED",failReason:null,balanceChanges:[],allowanceChanges:[],warnings:[] },simulationPrerequisite:"SIMULATABLE_NOW" };
}

describe("canonical approval gas metadata", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.chain.mockResolvedValue(56); mocks.estimate.mockResolvedValue(46_001n); });
  it("retains a valid Binance-provided gas limit without an RPC estimate", async () => {
    const action = approval("50000");
    await expect(ensureApprovalGasLimit(action)).resolves.toBe(action);
    expect(mocks.estimate).not.toHaveBeenCalled();
  });
  it("estimates the exact server action and applies a 20 percent ceiling buffer without changing semantics", async () => {
    const action = approval(null), result = await ensureApprovalGasLimit(action);
    expect(APPROVAL_GAS_BUFFER_BPS).toBe(12_000n);
    expect(result.gasLimit).toBe("55202");
    expect(mocks.estimate).toHaveBeenCalledWith({ account:owner,to:token,data:action.rawCalldata,value:0n });
    expect({ ...result,gasLimit:null }).toEqual(action);
  });
  it("fails closed when canonical estimation is unavailable", async () => {
    mocks.estimate.mockRejectedValue(new Error("RPC timeout"));
    await expect(ensureApprovalGasLimit(approval(null))).rejects.toThrow("GAS_ESTIMATE_UNAVAILABLE");
  });
});
