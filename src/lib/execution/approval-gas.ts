import "server-only";
import { decodeErc20Approval } from "@/domain/authorization/approval";
import { sameAddress } from "@/domain/routing/identity";
import { bscPublicClient, readBscWithRetry } from "./rpc";
import type { PreflightAction } from "@/types/preflight";

const positiveInteger = /^[1-9]\d*$/;
export const APPROVAL_GAS_BUFFER_BPS = 12_000n;

function bufferedGas(estimate: bigint): string {
  if (estimate <= 0n) throw new Error("GAS_ESTIMATE_UNAVAILABLE");
  return ((estimate * APPROVAL_GAS_BUFFER_BPS + 9_999n) / 10_000n).toString();
}

export async function ensureApprovalGasLimit(action: PreflightAction): Promise<PreflightAction> {
  if (action.kind !== "APPROVAL") throw new Error("APPROVAL_ACTION_REQUIRED");
  if (action.gasLimit && positiveInteger.test(action.gasLimit)) return action;
  try {
    if (!action.to || !action.rawCalldata || action.valueWei !== "0" || !sameAddress(action.to,action.tokenIn) ||
        !action.authorization || action.authorization.status !== "BOUNDED_READY" || action.authorization.scope !== "EXACT")
      throw new Error("INVALID_APPROVAL_GAS_ACTION");
    const decoded = decodeErc20Approval(action.rawCalldata);
    if (!sameAddress(decoded.spender,action.authorization.spender) || decoded.amountRaw !== action.authorization.allowedAmountRaw ||
        decoded.amountRaw !== action.amountInRaw) throw new Error("INVALID_APPROVAL_GAS_ACTION");
    const client = bscPublicClient();
    if (await readBscWithRetry(() => client.getChainId()) !== 56) throw new Error("WRONG_RPC_CHAIN");
    const estimate = await readBscWithRetry(() => client.estimateGas({ account:action.from,to:action.to!,
      data:action.rawCalldata as `0x${string}`,value:0n }));
    return { ...action,gasLimit:bufferedGas(estimate) };
  } catch {
    throw new Error("GAS_ESTIMATE_UNAVAILABLE");
  }
}
