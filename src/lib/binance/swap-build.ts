import "server-only";
import { z } from "zod";
import Decimal from "decimal.js";
import { signedRequest } from "./client";
import { parseApprovalSignatureData, unavailableSimulation, validateEvmAction, validateQuoteForBuild } from "@/domain/preflight/validate";
import { decimalText, rawToDecimal } from "@/domain/exposure/decimal";
import { sameAddress } from "@/domain/routing/identity";
import type { Address, QuoteSnapshot } from "@/types/route";
import type { PreflightAction } from "@/types/preflight";

const RawTx = z.object({
  from: z.string(), to: z.string(), data: z.string(), value: z.string(),
  gas: z.string().optional().nullable(), gasPrice: z.string().optional().nullable(),
  maxPriorityFeePerGas: z.string().optional().nullable(), maxFeePerGas: z.string().optional().nullable(),
  minReceiveAmount: z.string().optional(), slippagePercent: z.string().optional(),
  signatureData: z.array(z.string()).optional(),
});
const Build = z.object({
  executionMode: z.string(), tx: RawTx.optional().nullable(),
  rfq: z.object({ vendor: z.string().optional(), txType: z.string().optional(), signingScheme: z.string().optional(), typedDataToSign: z.string().optional(), signatureData: z.array(z.string()).optional() }).optional().nullable(),
  routerResult: z.object({ binanceChainId: z.string().optional(), fromTokenAmount: z.string().optional(), toTokenAmount: z.string().optional(), fromToken: z.object({ tokenContractAddress: z.string().optional() }).optional(), toToken: z.object({ tokenContractAddress: z.string().optional() }).optional() }).optional(),
});

export type SwapBuildPlan = {
  executionMode: "SWAP" | "RFQ";
  actions: PreflightAction[];
  evmTx: { from: Address; to: Address; value: string; data: string } | null;
  minReceiveRaw: string | null;
  quoteOutputRaw: string;
};

export async function buildSwapTransaction(quote: QuoteSnapshot, owner: Address, slippagePercent: string): Promise<SwapBuildPlan> {
  const inputLabel = quote.inputSymbol ?? (quote.leg === 1 ? "NVDAon" : "USDT");
  const outputLabel = quote.outputSymbol ?? (quote.leg === 1 ? "USDT" : "NVDAB");
  validateQuoteForBuild(quote);
  // Official Binance connector b1fe19c: GET /api/v1/dex/aggregator/swap.
  // The explicit slippage is derived from remaining user exposure budget, never loosened.
  // Approval amount is bounded to the exact input raw amount.
  const data = await signedRequest("GET", "/api/v1/dex/aggregator/swap", {
    params: {
      binanceChainId: "56", amount: quote.inputRaw, fromTokenAddress: quote.from, toTokenAddress: quote.to,
      userWalletAddress: owner, quoteId: quote.quoteId,
      approveTransaction: "true", approveAmount: quote.inputRaw, slippagePercent,
    },
  });
  const built = Build.parse(data);
  const route = built.routerResult;
  if (!route || route.binanceChainId !== "56" || route.fromTokenAmount !== quote.inputRaw ||
      !route.fromToken?.tokenContractAddress || !sameAddress(route.fromToken.tokenContractAddress, quote.from) ||
      !route.toToken?.tokenContractAddress || !sameAddress(route.toToken.tokenContractAddress, quote.to)) throw new Error("BUILD_ROUTE_IDENTITY_MISMATCH");
  const quoteOutputRaw = route.toTokenAmount;
  if (!quoteOutputRaw || !/^[1-9]\d*$/.test(quoteOutputRaw)) throw new Error("INVALID_BUILD_OUTPUT");
  if (quoteOutputRaw !== quote.outputRaw) throw new Error("BUILD_OUTPUT_CHANGED_REQUOTE_REQUIRED");
  if (built.executionMode === "SWAP") {
    if (!built.tx) throw new Error("MISSING_SWAP_TRANSACTION");
    const tx = built.tx;
    if (tx.slippagePercent !== undefined && (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(tx.slippagePercent) || new Decimal(tx.slippagePercent).gt(slippagePercent))) throw new Error("BUILD_SLIPPAGE_EXCEEDS_POLICY");
    const approval = parseApprovalSignatureData(tx.signatureData, quote.from, owner, quote.inputRaw, quote.inputDecimals ?? null).map(x => ({ ...x,
      tokenInLabel: inputLabel,
      amountInHuman: quote.inputDecimals == null ? null : decimalText(rawToDecimal(x.amountInRaw, quote.inputDecimals)),
    }));
    if (approval.length > 1 || approval.some(x => !x.approvalSpender || !sameAddress(x.approvalSpender, tx.to))) throw new Error("APPROVAL_SPENDER_MISMATCH");
    const action = validateEvmAction({
      kind: "SWAP", chainId: 56, from: tx.from, to: tx.to, data: tx.data, value: tx.value,
      valueFormat: "decimal-or-hex", gasLimit: tx.gas, gasPrice: tx.gasPrice,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas, maxFeePerGas: tx.maxFeePerGas,
      tokenIn: quote.from, tokenOut: quote.to, amountInRaw: quote.inputRaw,
      minAmountOutRaw: tx.minReceiveAmount, expectedFrom: owner,
    });
    if (BigInt(action.minAmountOutRaw!) > BigInt(quoteOutputRaw)) throw new Error("MIN_RECEIVE_EXCEEDS_QUOTE");
    const labeledAction = { ...action,
      tokenInLabel: inputLabel, tokenOutLabel: outputLabel,
      amountInHuman: quote.inputDecimals == null ? null : decimalText(rawToDecimal(action.amountInRaw, quote.inputDecimals)),
      minAmountOutHuman: quote.outputDecimals == null ? null : decimalText(rawToDecimal(action.minAmountOutRaw!, quote.outputDecimals)),
      slippagePercent: tx.slippagePercent ?? null,
    };
    return { executionMode: "SWAP", actions: [...approval, labeledAction], evmTx: { from: action.from, to: action.to!, value: action.valueWei!, data: tx.data }, minReceiveRaw: action.minAmountOutRaw, quoteOutputRaw };
  }
  if (built.executionMode === "RFQ") {
    if (!built.rfq?.typedDataToSign || built.rfq.txType !== "EIP712") throw new Error("INVALID_RFQ_PAYLOAD");
    if (built.rfq.signatureData?.length) throw new Error("RFQ_APPROVAL_SPENDER_UNVERIFIED");
    const rfq: PreflightAction = {
      kind: "RFQ", chainId: 56, from: owner, to: null, valueWei: null, rawCalldata: null,
      calldataSummary: `EIP-712 RFQ signing request${built.rfq.vendor ? ` · ${built.rfq.vendor}` : ""}`,
      gasLimit: null, gasPrice: null, maxPriorityFeePerGas: null, maxFeePerGas: null,
      tokenIn: quote.from, tokenOut: quote.to, amountInRaw: quote.inputRaw, minAmountOutRaw: null,
      amountInHuman: quote.inputDecimals == null ? null : decimalText(rawToDecimal(quote.inputRaw, quote.inputDecimals)),
      minAmountOutHuman: null, slippagePercent: null, tokenInLabel: inputLabel, tokenOutLabel: outputLabel,
      approvalSpender: null, approvalAmountRaw: null,
      approvalExceedsInput: false, authorization: null,
      simulation: unavailableSimulation("RFQ is a typed-data signing path, not an EVM swap transaction."), simulationPrerequisite: "SIMULATABLE_NOW",
    };
    return { executionMode: "RFQ", actions: [rfq], evmTx: null, minReceiveRaw: null, quoteOutputRaw };
  }
  throw new Error("UNSUPPORTED_EXECUTION_MODE");
}
