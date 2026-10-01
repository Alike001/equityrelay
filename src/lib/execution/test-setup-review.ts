import "server-only";
import { erc20Abi } from "viem";
import { executionActionV1 } from "@/domain/execution/action";
import { prepareTestSetup } from "@/domain/execution/test-setup";
import { USDT_ADDRESS } from "@/domain/routing/identity";
import { requestQuote } from "@/lib/binance/trading";
import { buildSwapTransaction } from "@/lib/binance/swap-build";
import { bscPublicClient, readBscWithRetry } from "./rpc";
import { createServerReview } from "./review";
import { getExecutionRoute, persistPreparedReview } from "./repository";
import type { Address, QuoteSnapshot } from "@/types/route";
import { equityConfig } from "@/domain/equities/registry";

async function freshSetupQuote(wallet: Address, source: Address, requiredRaw: string, baseUsdtRaw: string): Promise<QuoteSnapshot> {
  for (const bps of [10000n,10025n,10050n,10075n,10100n,10200n,10500n,11000n,12500n,15000n,20000n]) {
    const input = (BigInt(baseUsdtRaw) * bps / 10000n).toString();
    const quote = await requestQuote(2, USDT_ADDRESS, source, input, wallet);
    if (quote?.quoteId && BigInt(quote.outputRaw) >= BigInt(requiredRaw)) return quote;
  }
  throw new Error("TEST_SETUP_QUOTE_UNAVAILABLE");
}

export async function prepareDurableTestSetupReview(routeId: string, wallet: Address) {
  const stored = await getExecutionRoute(routeId, wallet);
  if (!stored || stored.state !== "ROUTE_POLICY_PASS" || stored.session.testSetup) throw new Error("TEST_SETUP_NOT_REVIEWABLE");
  const config = equityConfig(stored.session.intent.underlying);
  const balance = await readBscWithRetry(() => bscPublicClient().readContract({ address: stored.session.originalSource.address,
    abi: erc20Abi, functionName: "balanceOf", args: [wallet] }));
  if (balance >= BigInt(stored.session.originalSourceRaw)) return { state: "NOT_REQUIRED" as const, executionArmed: false };
  const quote = await freshSetupQuote(wallet, stored.session.originalSource.address, stored.session.originalSourceRaw, stored.session.initialQuote.outputRaw);
  const build = await buildSwapTransaction(quote, wallet, "0.5");
  if (!build.evmTx) throw new Error("TEST_SETUP_RFQ_UNSUPPORTED");
  const swap = build.actions.find(action => action.kind === "SWAP"), approval = build.actions.find(action => action.kind === "APPROVAL");
  if (!swap) throw new Error("TEST_SETUP_BUILD_UNAVAILABLE");
  const labeled = { ...swap, tokenInLabel: "USDT", tokenOutLabel: config.sourceSymbol };
  const review = await createServerReview({ boundary: "TEST_SETUP", owner: wallet, action: labeled,
    approval: approval?.authorization ?? null, quote, destination: null });
  const nextAction = !review.allowanceSufficient && approval ? { ...approval, tokenInLabel: "USDT" } : labeled;
  const stage = nextAction.kind === "APPROVAL" ? "TEST_SETUP_APPROVAL" : "TEST_SETUP_SWAP";
  const session = prepareTestSetup(stored.session, quote, review);
  const step = await persistPreparedReview(routeId, wallet, stored.version, session,
    executionActionV1({ routeId, stage, action: nextAction, planIdentity: quote.quoteId! }),
    { quote: { quoteId: quote.quoteId, observedAt: quote.observedAt, expiresAt: quote.expiresAt, inputRaw: quote.inputRaw },
      authorization: nextAction.authorization, gas: { gasLimit: nextAction.gasLimit, gasPrice: nextAction.gasPrice,
        maxFeePerGas: nextAction.maxFeePerGas, maxPriorityFeePerGas: nextAction.maxPriorityFeePerGas } });
  return { state: "TEST_SETUP_REVIEW_READY" as const, label: "TEST SETUP — NOT PART OF EQUITYRELAY ROUTE", stepId: step.id,
    stage, actionHash: step.actionHash, usdtInputRaw: quote.inputRaw, expectedSourceRaw: quote.outputRaw,
    sourceSymbol: config.sourceSymbol, executionArmed: false };
}
