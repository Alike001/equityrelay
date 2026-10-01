import "server-only";
import { erc20Abi } from "viem";
import { bscPublicClient } from "@/lib/execution/rpc";
import type { ExecutionActionV1 } from "@/domain/execution/action";
import type { QuoteSnapshot } from "@/types/route";

// This is an EquityRelay review window, not an asserted Binance quote TTL.
export const MAX_REVIEW_QUOTE_AGE_MS = 30_000;
export const MAX_CONFIRMATION_TTL_MS = 2 * 60_000;

export function quoteForAction(session: import("@/types/execution").ExecutionSession, action: ExecutionActionV1): QuoteSnapshot | null {
  if (action.stage.startsWith("TEST_SETUP_")) return session.testSetup?.quote ?? null;
  if (action.stage.startsWith("LEG1_")) return session.initialQuote;
  if (action.stage.startsWith("LEG2_")) return session.freshLeg2;
  if (action.stage.startsWith("EXIT_")) return session.recovery?.freshExitQuote ?? null;
  return null;
}

export function confirmationExpiryForAction(session: import("@/types/execution").ExecutionSession, action: ExecutionActionV1,
  now = new Date()): Date {
  const normalExpiry = now.getTime() + MAX_CONFIRMATION_TTL_MS;
  const quote = quoteForAction(session, action);
  if (!quote) return new Date(normalExpiry);
  requireCurrentQuote(quote, action.planIdentity, now);
  const observedExpiry = Date.parse(quote.observedAt) + MAX_REVIEW_QUOTE_AGE_MS;
  const providerExpiry = quote.expiresAt ? Date.parse(quote.expiresAt) : Number.POSITIVE_INFINITY;
  const clipped = Math.min(normalExpiry, observedExpiry, providerExpiry);
  if (!Number.isFinite(clipped) || clipped <= now.getTime()) throw new Error("QUOTE_REFRESH_REQUIRED");
  return new Date(clipped);
}
export function requireCurrentQuote(quote: QuoteSnapshot | null, planIdentity: string, now = new Date()): void {
  if (!quote?.quoteId || quote.quoteId !== planIdentity || !Number.isFinite(Date.parse(quote.observedAt)) ||
      now.getTime() - Date.parse(quote.observedAt) > MAX_REVIEW_QUOTE_AGE_MS ||
      Date.parse(quote.observedAt) > now.getTime() || quote.expiresAt && Date.parse(quote.expiresAt) <= now.getTime())
    throw new Error("QUOTE_REVIEW_EXPIRED");
}

export async function requireActionReadiness(action: ExecutionActionV1, recommendedGasLimit: string): Promise<void> {
  if (!/^[1-9]\d*$/.test(recommendedGasLimit)) throw new Error("GAS_ESTIMATE_UNAVAILABLE");
  const client = bscPublicClient();
  if (await client.getChainId() !== 56) throw new Error("WRONG_RPC_CHAIN");
  const [nativeBalance, gasPrice, tokenBalance] = await Promise.all([
    client.getBalance({ address: action.from }), client.getGasPrice(),
    client.readContract({ address: action.tokenIn, abi: erc20Abi, functionName: "balanceOf", args: [action.from] }),
  ]);
  if (nativeBalance < BigInt(recommendedGasLimit) * gasPrice * 2n) throw new Error("INSUFFICIENT_BNB_GAS_RESERVE");
  if (tokenBalance < BigInt(action.amountInRaw)) throw new Error("INSUFFICIENT_SOURCE_BALANCE");
  if (action.kind !== "APPROVAL" && action.kind !== "REDEEM") {
    const allowance = await client.readContract({ address: action.tokenIn, abi: erc20Abi, functionName: "allowance", args: [action.from, action.to] });
    if (allowance < BigInt(action.amountInRaw)) throw new Error("CONFIRMED_ALLOWANCE_REQUIRED");
  }
}
