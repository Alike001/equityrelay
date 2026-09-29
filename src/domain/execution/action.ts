import { keccak256, stringToHex } from "viem";
import { decodeErc20Approval } from "@/domain/authorization/approval";
import { isAddress, sameAddress } from "@/domain/routing/identity";
import type { PreflightAction } from "@/types/preflight";
import type { Address } from "@/types/route";

export type ExecutionActionV1 = {
  version: "ExecutionActionV1";
  routeId: string;
  stage: "LEG1_APPROVAL" | "LEG1_SWAP" | "LEG2_APPROVAL" | "LEG2_SWAP" | "VENUS_APPROVAL" | "VENUS_DEPOSIT";
  kind: "APPROVAL" | "SWAP" | "DEPOSIT";
  chainId: 56;
  from: Address;
  to: Address;
  data: `0x${string}`;
  valueWei: string;
  tokenIn: Address;
  tokenOut: Address | null;
  amountInRaw: string;
  approvalSpender: Address | null;
  approvalAmountRaw: string | null;
  planIdentity: string;
  planRevision: string;
};

const raw = /^(0|[1-9]\d*)$/;
const dataHex = /^0x(?:[a-fA-F0-9]{2})+$/;
function address(value: string): Address {
  if (!isAddress(value) || sameAddress(value, "0x0000000000000000000000000000000000000000")) throw new Error("INVALID_ACTION_ADDRESS");
  return value.toLowerCase() as Address;
}

export function executionActionV1(input: {
  routeId: string; stage: ExecutionActionV1["stage"]; action: PreflightAction; planIdentity: string; planRevision?: string;
}): ExecutionActionV1 {
  const { action, routeId, stage, planIdentity } = input;
  if (!routeId || !planIdentity || action.chainId !== 56 || !action.to || !action.rawCalldata ||
      !dataHex.test(action.rawCalldata) || action.valueWei === null || !raw.test(action.valueWei) ||
      !/^[1-9]\d*$/.test(action.amountInRaw) || action.kind === "RFQ") throw new Error("INVALID_EXECUTION_ACTION");
  if (action.valueWei !== "0") throw new Error("UNEXPECTED_NATIVE_VALUE");
  const expectedKind = stage.endsWith("APPROVAL") ? "APPROVAL" : stage.endsWith("DEPOSIT") ? "DEPOSIT" : "SWAP";
  if (action.kind !== expectedKind) throw new Error("ACTION_STAGE_MISMATCH");
  let spender: Address | null = null, approvalAmountRaw: string | null = null;
  if (action.kind === "APPROVAL") {
    const decoded = decodeErc20Approval(action.rawCalldata);
    if (!sameAddress(action.to, action.tokenIn) || !action.authorization || action.authorization.status !== "BOUNDED_READY" ||
        action.authorization.scope !== "EXACT" || !sameAddress(decoded.spender, action.authorization.spender) ||
        decoded.amountRaw !== action.authorization.allowedAmountRaw || decoded.amountRaw !== action.amountInRaw) throw new Error("AUTHORIZATION_NOT_BOUNDED");
    spender = address(decoded.spender);
    approvalAmountRaw = decoded.amountRaw;
  }
  return {
    version: "ExecutionActionV1", routeId, stage, kind: action.kind, chainId: 56,
    from: address(action.from), to: address(action.to), data: action.rawCalldata.toLowerCase() as `0x${string}`,
    valueWei: action.valueWei, tokenIn: address(action.tokenIn), tokenOut: action.tokenOut ? address(action.tokenOut) : null,
    amountInRaw: action.amountInRaw, approvalSpender: spender, approvalAmountRaw, planIdentity,
    planRevision: input.planRevision ?? "initial",
  };
}

// Property order is explicit and versioned. Gas and nonce are deliberately absent.
export function serializeExecutionAction(action: ExecutionActionV1): string {
  return JSON.stringify([
    action.version, action.routeId, action.stage, action.kind, action.chainId, action.from.toLowerCase(),
    action.to.toLowerCase(), action.data.toLowerCase(), action.valueWei, action.tokenIn.toLowerCase(),
    action.tokenOut?.toLowerCase() ?? null, action.amountInRaw, action.approvalSpender?.toLowerCase() ?? null,
    action.approvalAmountRaw, action.planIdentity, action.planRevision,
  ]);
}

export function executionActionHash(action: ExecutionActionV1): `0x${string}` {
  return keccak256(stringToHex(serializeExecutionAction(action)));
}

export function matchTransactionSemantics(action: ExecutionActionV1, transaction: {
  from: string; to: string | null; input: string; value: bigint; chainId: number;
}): void {
  if (transaction.chainId !== 56 || !transaction.to || !sameAddress(transaction.from, action.from) ||
      !sameAddress(transaction.to, action.to) || transaction.input.toLowerCase() !== action.data.toLowerCase() ||
      transaction.value.toString() !== action.valueWei) throw new Error("CANONICAL_ACTION_MISMATCH");
  if (action.kind === "APPROVAL") {
    const decoded = decodeErc20Approval(transaction.input);
    if (!sameAddress(transaction.to, action.tokenIn) || !sameAddress(decoded.spender, action.approvalSpender ?? "") ||
        decoded.amountRaw !== action.approvalAmountRaw) throw new Error("CANONICAL_APPROVAL_MISMATCH");
  }
}
