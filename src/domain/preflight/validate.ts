import { z } from "zod";
import Decimal from "decimal.js";
import { isAddress, sameAddress } from "@/domain/routing/identity";
import type { Address, QuoteSnapshot, RouteDecision } from "@/types/route";
import type { PreflightAction, SimulationResult } from "@/types/preflight";

const ZERO = "0x0000000000000000000000000000000000000000";
const decimalInteger = /^(?:0|[1-9]\d*)$/;
const positiveInteger = /^[1-9]\d*$/;
const hexData = /^0x(?:[a-fA-F0-9]{2})+$/;
const hexValue = /^0x[a-fA-F0-9]+$/;

export function parseUnsignedValue(value: unknown, format: "decimal-or-hex" | "hex"): string {
  if (typeof value !== "string" || !(format === "hex" ? hexValue.test(value) : decimalInteger.test(value) || hexValue.test(value))) throw new Error("INVALID_TRANSACTION_VALUE");
  return (value.startsWith("0x") ? BigInt(value) : BigInt(value)).toString();
}

export function parseGas(value: unknown, allowZero = false): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !(allowZero ? decimalInteger : positiveInteger).test(value)) throw new Error("INVALID_GAS_FIELD");
  return value;
}

function checkedAddress(value: unknown): Address {
  if (!isAddress(value) || sameAddress(value, ZERO)) throw new Error("INVALID_TRANSACTION_ADDRESS");
  return value;
}

export function validateEvmAction(input: {
  kind: "SWAP" | "DEPOSIT" | "APPROVAL";
  chainId: number;
  from: unknown; to: unknown; data: unknown; value: unknown;
  valueFormat: "decimal-or-hex" | "hex";
  gasLimit?: unknown; gasPrice?: unknown; maxPriorityFeePerGas?: unknown; maxFeePerGas?: unknown;
  tokenIn: Address; tokenOut: Address | null; amountInRaw: string; minAmountOutRaw?: string | null;
  expectedFrom: Address; expectedTo?: Address;
}): PreflightAction {
  if (input.chainId !== 56) throw new Error("INVALID_CHAIN");
  const from = checkedAddress(input.from);
  const to = checkedAddress(input.to);
  if (!sameAddress(from, input.expectedFrom) || (input.expectedTo && !sameAddress(to, input.expectedTo))) throw new Error("INVALID_TRANSACTION_ADDRESS");
  if (typeof input.data !== "string" || !hexData.test(input.data)) throw new Error("INVALID_CALLDATA");
  const valueWei = parseUnsignedValue(input.value, input.valueFormat);
  if (valueWei !== "0") throw new Error("UNEXPECTED_NATIVE_VALUE");
  if (!positiveInteger.test(input.amountInRaw)) throw new Error("INVALID_AMOUNT");
  if (input.kind === "SWAP" && (typeof input.minAmountOutRaw !== "string" || !positiveInteger.test(input.minAmountOutRaw))) throw new Error("MISSING_MIN_RECEIVE");
  return {
    kind: input.kind, chainId: 56, from, to, valueWei,
    calldataSummary: `${input.data.slice(0, 10)} · ${Math.floor((input.data.length - 2) / 2)} bytes`, rawCalldata: input.data,
    gasLimit: parseGas(input.gasLimit), gasPrice: parseGas(input.gasPrice, true),
    maxPriorityFeePerGas: parseGas(input.maxPriorityFeePerGas, true), maxFeePerGas: parseGas(input.maxFeePerGas, true),
    tokenIn: input.tokenIn, tokenOut: input.tokenOut, amountInRaw: input.amountInRaw,
    minAmountOutRaw: input.minAmountOutRaw ?? null, amountInHuman: null, minAmountOutHuman: null, slippagePercent: null, tokenInLabel: "Token", tokenOutLabel: null,
    approvalSpender: null, approvalAmountRaw: null, approvalExceedsInput: false,
    simulation: unavailableSimulation("Simulation has not run."),
  };
}

export function parseApprovalSignatureData(signatureData: unknown, token: Address, owner: Address, requestedRaw: string): PreflightAction[] {
  if (signatureData === null || signatureData === undefined) return [];
  if (!Array.isArray(signatureData)) throw new Error("UNSUPPORTED_APPROVAL_FORMAT");
  return signatureData.map(item => {
    let parsed: unknown;
    try { parsed = JSON.parse(item); } catch { throw new Error("UNSUPPORTED_APPROVAL_FORMAT"); }
    const fields = z.object({ approveContract: z.string(), approveTxCalldata: z.string() }).parse(parsed);
    const spender = checkedAddress(fields.approveContract);
    const calldata = fields.approveTxCalldata;
    const decoded = decodeApprovalCalldata(calldata, requestedRaw);
    if (!sameAddress(decoded.spender, spender)) throw new Error("APPROVAL_SPENDER_MISMATCH");
    const amount = decoded.amountRaw;
    const action = validateEvmAction({ kind: "APPROVAL", chainId: 56, from: owner, to: token, data: calldata, value: "0", valueFormat: "decimal-or-hex", tokenIn: token, tokenOut: null, amountInRaw: amount, expectedFrom: owner, expectedTo: token });
    return { ...action, approvalSpender: spender, approvalAmountRaw: amount };
  });
}

export function decodeApprovalCalldata(calldata: string, requestedRaw: string, allowExcess = false): { spender: Address; amountRaw: string; exceedsInput: boolean } {
  if (!/^0x095ea7b3[a-fA-F0-9]{128}$/.test(calldata)) throw new Error("UNSUPPORTED_APPROVAL_FORMAT");
  const spender = checkedAddress(`0x${calldata.slice(34, 74)}`);
  const amountRaw = BigInt(`0x${calldata.slice(74, 138)}`).toString();
  if (amountRaw === "0" || !positiveInteger.test(requestedRaw)) throw new Error("INVALID_APPROVAL_AMOUNT");
  const exceedsInput = BigInt(amountRaw) > BigInt(requestedRaw);
  if (exceedsInput && !allowExcess) throw new Error("APPROVAL_AMOUNT_EXCEEDS_INPUT");
  return { spender, amountRaw, exceedsInput };
}

export function unavailableSimulation(reason: string): SimulationResult {
  return { status: "UNAVAILABLE", failReason: reason, balanceChanges: [], allowanceChanges: [], warnings: [] };
}

export function isWalletStateFailure(reason: string): boolean {
  return /(?:insufficient[\s_-]*(?:token\s*)?(?:balance|allowance|funds)|ERC20Insufficient(?:Balance|Allowance)|transfer amount exceeds balance|not enough (?:balance|allowance))/i.test(reason);
}

const Simulation = z.object({
  status: z.string(), failReason: z.string().nullable().optional(),
  balanceChanges: z.array(z.object({ contractAddress: z.string().optional(), owner: z.string().optional(), change: z.string().optional() })).optional(),
  allowanceChanges: z.array(z.object({ tokenAddress: z.string().optional(), owner: z.string().optional(), spender: z.string().optional(), preAmount: z.string().optional(), postAmount: z.string().optional() })).optional(),
});

export function parseSimulation(value: unknown): SimulationResult {
  const data = Simulation.parse(value);
  const reason = data.failReason?.trim() || null;
  const success = data.status.toUpperCase() === "SUCCESS" || data.status.toUpperCase() === "PASSED";
  const status = success && !reason ? "PASSED" : reason && isWalletStateFailure(reason) ? "BLOCKED_BY_WALLET_STATE" : "FAILED";
  return {
    status, failReason: reason ?? (status === "FAILED" ? `Simulation status: ${data.status}` : null),
    balanceChanges: (data.balanceChanges ?? []).map(x => ({ tokenAddress: x.contractAddress ?? "", owner: x.owner ?? "", change: x.change ?? "" })),
    allowanceChanges: (data.allowanceChanges ?? []).map(x => ({ tokenAddress: x.tokenAddress ?? "", owner: x.owner ?? "", spender: x.spender ?? "", before: x.preAmount ?? "", after: x.postAmount ?? "" })),
    warnings: [],
  };
}

export function validateQuoteForBuild(quote: QuoteSnapshot | null): asserts quote is QuoteSnapshot & { quoteId: string } {
  if (!quote || !quote.quoteId || !quote.quoteId.trim()) throw new Error("MISSING_QUOTE_ID");
  if (quote.expiresAt && Date.parse(quote.expiresAt) <= Date.now()) throw new Error("QUOTE_EXPIRED");
  // Official Binance connector, trading-api.ts at b1fe19c: quoteId TTL is approximately 30 seconds.
  // Refresh well before that approximate limit; do not publish this as a guaranteed expiry.
  if (Date.now() - Date.parse(quote.observedAt) > 25000) throw new Error("QUOTE_TOO_OLD_FOR_BUILD");
}

export function derivePerLegSlippagePercent(preview: RouteDecision): string {
  const quotedRetention = new Decimal(preview.retentionPercent).div(100);
  const minimumRetention = new Decimal(1).minus(new Decimal(preview.maxExposureLossBps).div(10000));
  if (!quotedRetention.gt(0) || quotedRetention.lt(minimumRetention)) throw new Error("ROUTE_POLICY_NOT_PASS");
  // Split the remaining exposure budget over two sequential quote legs. The actual
  // built min-receive amounts are checked again; execution still requires a fresh leg 2.
  return new Decimal(1).minus(minimumRetention.div(quotedRetention).sqrt()).mul(100).toFixed(6, Decimal.ROUND_DOWN);
}
