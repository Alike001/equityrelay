import "server-only";
import Decimal from "decimal.js";
import { normalizedShares } from "@/domain/exposure/decimal";
import { deriveSettlement } from "@/domain/execution/settlement";
import { measureSettlement, recheckPolicy, rediscoverVenus, requoteLeg2 } from "@/domain/execution/lifecycle";
import { USDT_ADDRESS } from "@/domain/routing/identity";
import type { ConfirmedTransaction, ExecutionSession } from "@/types/execution";
import { discoverRepresentations } from "@/lib/binance/rwa";
import { requestQuote } from "@/lib/binance/trading";
import { discoverVenusInvestment } from "@/lib/binance/defi";
import { buildSwapTransaction } from "@/lib/binance/swap-build";
import { buildVenusDeposit } from "@/lib/binance/defi-transaction";

export async function prepareLeg2AfterConfirmedLeg1(session: ExecutionSession, receipt: ConfirmedTransaction) {
  const settlement = deriveSettlement(receipt, session.owner, session.originalSource.address, USDT_ADDRESS);
  let next = measureSettlement(session, "LEG1", settlement);
  const { target } = await discoverRepresentations();
  const quote = await requestQuote(2, USDT_ADDRESS, target.address, settlement.actualAmountOutRaw, session.owner);
  if (!quote) throw new Error("FRESH_LEG2_QUOTE_UNAVAILABLE");
  next = recheckPolicy(requoteLeg2(next, quote, target));
  if (next.stage === "PARTIAL_ROUTE_STOPPED") return { session: next, build: null };
  // The fresh quote is built only after actual USDT settlement and policy recheck.
  const minimumShares = new Decimal(session.sourceShares).mul(new Decimal(1).minus(new Decimal(session.intent.maxExposureLossBps).div(10000)));
  const quotedShares = normalizedShares(quote.outputRaw, target.decimals, target.tokenToShareRatio);
  const slippage = new Decimal(1).minus(minimumShares.div(quotedShares)).mul(100).toFixed(6, Decimal.ROUND_DOWN);
  if (new Decimal(slippage).lt(0)) throw new Error("FRESH_POLICY_BLOCKED");
  const build = await buildSwapTransaction(quote, session.owner, slippage);
  if (!build.minReceiveRaw || normalizedShares(build.minReceiveRaw, target.decimals, target.tokenToShareRatio).lt(minimumShares))
    throw new Error("BUILD_MIN_RECEIVE_EXCEEDS_POLICY");
  return { session: next, build };
}

export async function prepareVenusAfterConfirmedLeg2(session: ExecutionSession, receipt: ConfirmedTransaction) {
  if (!session.freshTarget) throw new Error("FRESH_TARGET_REQUIRED");
  const settlement = deriveSettlement(receipt, session.owner, USDT_ADDRESS, session.freshTarget.address);
  let next = measureSettlement(session, "LEG2", settlement);
  const destination = await discoverVenusInvestment();
  if (!destination) throw new Error("VENUS_DESTINATION_UNAVAILABLE");
  next = rediscoverVenus(next, destination);
  // The DeFi builder rejects a broad Binance approval and replaces it with an exact unsigned approval.
  const deposit = await buildVenusDeposit(session.owner, destination, session.freshTarget, settlement.actualAmountOutRaw);
  if (deposit.buildStatus !== "READY" || deposit.authorizationStatus !== "BOUNDED_READY" ||
      deposit.actions.at(-1)?.amountInRaw !== settlement.actualAmountOutRaw) throw new Error("VENUS_BOUNDED_BUILD_REQUIRED");
  return { session: next, deposit };
}
