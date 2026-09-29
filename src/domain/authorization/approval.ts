import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";
import { isAddress, sameAddress } from "@/domain/routing/identity";
import { decimalText, rawToDecimal } from "@/domain/exposure/decimal";
import type { Address } from "@/types/route";
import type { AuthorizationReview } from "@/types/preflight";

const APPROVE_ABI = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }] as const;
const ZERO = "0x0000000000000000000000000000000000000000";
const positiveRaw = /^[1-9]\d*$/;

export function decodeErc20Approval(data: unknown): { spender: Address; amountRaw: string } {
  if (typeof data !== "string" || !/^0x(?:[a-fA-F0-9]{2})+$/.test(data)) throw new Error("INVALID_APPROVAL_CALLDATA");
  try {
    const decoded = decodeFunctionData({ abi: APPROVE_ABI, data: data as Hex });
    if (decoded.functionName !== "approve" || !decoded.args || decoded.args.length !== 2) throw new Error("INVALID_APPROVAL_SELECTOR");
    const [spender, amount] = decoded.args;
    if (!isAddress(spender) || sameAddress(spender, ZERO)) throw new Error("ZERO_APPROVAL_SPENDER");
    // A canonical round trip also rejects extra bytes and noncanonical ABI padding.
    if (encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [spender, amount] }).toLowerCase() !== data.toLowerCase()) throw new Error("INVALID_APPROVAL_CALLDATA");
    if (amount <= 0n) throw new Error("INVALID_APPROVAL_AMOUNT");
    return { spender, amountRaw: amount.toString() };
  } catch (error) {
    if (error instanceof Error && /^(?:ZERO_APPROVAL_SPENDER|INVALID_APPROVAL_CALLDATA|INVALID_APPROVAL_SELECTOR|INVALID_APPROVAL_AMOUNT)$/.test(error.message)) throw error;
    throw new Error("INVALID_APPROVAL_SELECTOR");
  }
}

export function encodeExactApproval(spender: Address, amountRaw: string): Hex {
  if (!isAddress(spender) || sameAddress(spender, ZERO)) throw new Error("ZERO_APPROVAL_SPENDER");
  if (!positiveRaw.test(amountRaw)) throw new Error("INVALID_APPROVAL_AMOUNT");
  const data = encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [spender, BigInt(amountRaw)] });
  const decoded = decodeErc20Approval(data);
  if (!sameAddress(decoded.spender, spender) || decoded.amountRaw !== amountRaw) throw new Error("INVALID_APPROVAL_CALLDATA");
  return data;
}

export function reviewApproval(input: { token: Address; spender: Address; requestedAmountRaw: string; allowedAmountRaw: string; decimals: number | null; source: AuthorizationReview["source"] }): AuthorizationReview {
  const requested = BigInt(input.requestedAmountRaw);
  const allowed = BigInt(input.allowedAmountRaw);
  const scope = requested > allowed ? "BROAD" : requested < allowed ? "INSUFFICIENT" : "EXACT";
  return {
    token: input.token, spender: input.spender,
    requestedAmountRaw: input.requestedAmountRaw, allowedAmountRaw: input.allowedAmountRaw,
    requestedAmountHuman: input.decimals === null ? null : decimalText(rawToDecimal(input.requestedAmountRaw, input.decimals)),
    allowedAmountHuman: input.decimals === null ? null : decimalText(rawToDecimal(input.allowedAmountRaw, input.decimals)),
    scope, source: input.source,
    status: scope === "BROAD" ? "BROAD_APPROVAL_REJECTED" : scope === "INSUFFICIENT" ? "INVALID_APPROVAL" : "BOUNDED_READY",
    reasonCodes: [scope === "BROAD" ? "BLOCK_AUTHORIZATION_SCOPE" : scope === "INSUFFICIENT" ? "APPROVAL_BELOW_REQUIRED" : "APPROVAL_EXACT_AMOUNT"],
  };
}
