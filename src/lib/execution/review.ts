import "server-only";
import { allowanceCovers, readCurrentAllowance } from "./allowance";
import { sameAddress } from "@/domain/routing/identity";
import type { AuthorizationReview, PreflightAction } from "@/types/preflight";
import type { ConfirmationBoundary, ExecutionReview } from "@/types/execution";
import type { Address, DestinationSnapshot, QuoteSnapshot } from "@/types/route";

export async function createServerReview(input: { boundary: ConfirmationBoundary; owner: Address; action: PreflightAction; approval: AuthorizationReview | null; quote: QuoteSnapshot | null; destination: DestinationSnapshot | null }): Promise<ExecutionReview> {
  const { boundary, owner, action, approval, quote, destination } = input;
  if (!sameAddress(action.from, owner) || !action.to || action.chainId !== 56 || action.valueWei !== "0") throw new Error("INVALID_SERVER_ACTION");
  if (boundary !== "SUPPLY_TO_VENUS" && (!quote || quote.inputRaw !== action.amountInRaw || !sameAddress(quote.from, action.tokenIn))) throw new Error("QUOTE_ACTION_MISMATCH");
  if (boundary === "SUPPLY_TO_VENUS" && (!destination?.investable || action.kind !== "DEPOSIT")) throw new Error("VENUS_NOT_READY");
  const spender = approval?.spender ?? action.to;
  if (!sameAddress(spender, action.to)) throw new Error("APPROVAL_SPENDER_MISMATCH");
  const currentAllowance = await readCurrentAllowance(action.tokenIn, owner, spender);
  const allowanceSufficient = allowanceCovers(currentAllowance, action.amountInRaw);
  if (!allowanceSufficient && (!approval || approval.status !== "BOUNDED_READY" || approval.scope !== "EXACT" ||
      approval.requestedAmountRaw !== action.amountInRaw || approval.allowedAmountRaw !== action.amountInRaw ||
      !sameAddress(approval.token, action.tokenIn))) throw new Error("BOUNDED_APPROVAL_REQUIRED");
  return { boundary, action, approval: allowanceSufficient ? null : approval, allowanceSufficient,
    simulation: action.simulation.status, quote, destination, createdAt: new Date().toISOString() };
}
