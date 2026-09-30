import { sameAddress, NVDAB_ADDRESS, USDT_ADDRESS, VENUS_VNVDAB_ADDRESS } from "@/domain/routing/identity";
import type { ExecutionActionV1 } from "./action";
import type { ExecutionSession, RecoveryState, SettlementEvidence } from "@/types/execution";
import type { QuoteSnapshot } from "@/types/route";
import type { TransactionObservation } from "@/types/execution";

type VenusPosition = NonNullable<ExecutionSession["recovery"]>["venusPosition"];

export function beginVenusRecovery(session: ExecutionSession, position: VenusPosition): ExecutionSession {
  if (session.stage !== "VENUS_CONFIRMED" || session.recovery || !session.venus?.investable ||
      !sameAddress(position.market, VENUS_VNVDAB_ADDRESS) || position.investmentId !== session.venus.investmentId ||
      !/^[1-9]\d*$/.test(position.underlyingAmountRaw) || !/^[1-9]\d*$/.test(position.vTokenAmountRaw))
    throw new Error("VERIFIED_VENUS_POSITION_REQUIRED");
  return { ...session, recovery: { state: "VENUS_POSITION_VERIFIED", recoveryState: "RECOVERABLE_FROM_VENUS", venusPosition: position,
    redeemExpectedUnderlyingRaw: null, redeemSettlement: null, freshExitQuote: null, exitSettlement: null },
    events: [...session.events, { kind: "VENUS_POSITION_VERIFIED", observedAt: new Date().toISOString() }] };
}

export function prepareRedeemRecovery(session: ExecutionSession, action: ExecutionActionV1, expectedUnderlyingRaw: string): ExecutionSession {
  const recovery = session.recovery;
  if (!recovery || recovery.state !== "VENUS_POSITION_VERIFIED" || action.stage !== "VENUS_REDEEM" || action.kind !== "REDEEM" ||
      !sameAddress(action.from, session.owner) || !sameAddress(action.to, recovery.venusPosition.market) ||
      !sameAddress(action.tokenIn, VENUS_VNVDAB_ADDRESS) || !sameAddress(action.tokenOut ?? "", NVDAB_ADDRESS) ||
      action.amountInRaw !== recovery.venusPosition.vTokenAmountRaw || !/^[1-9]\d*$/.test(expectedUnderlyingRaw))
    throw new Error("VENUS_REDEEM_REVIEW_INVALID");
  return { ...session, recovery: { ...recovery, state: "REDEEM_REVIEW_READY", redeemExpectedUnderlyingRaw: expectedUnderlyingRaw },
    events: [...session.events, { kind: "VENUS_REDEEM_REVIEWED", observedAt: new Date().toISOString() }] };
}

export function recordRedeemedNvdab(session: ExecutionSession, evidence: SettlementEvidence): ExecutionSession {
  const recovery = session.recovery;
  if (!recovery || recovery.state !== "REDEEM_CONFIRMED" || !sameAddress(evidence.outputToken, NVDAB_ADDRESS) ||
      !sameAddress(evidence.outputRecipient, session.owner) || evidence.actualAmountInRaw !== recovery.venusPosition.vTokenAmountRaw ||
      !/^[1-9]\d*$/.test(evidence.actualAmountOutRaw)) throw new Error("CANONICAL_REDEMPTION_REQUIRED");
  return { ...session, recovery: { ...recovery, state: "ACTUAL_NVDAB_REDEEMED", recoveryState: "RECOVERABLE_AS_NVDAB", redeemSettlement: evidence },
    events: [...session.events, { kind: "ACTUAL_NVDAB_REDEEMED", observedAt: evidence.confirmedAt }] };
}

export function prepareExitRecovery(session: ExecutionSession, quote: QuoteSnapshot, action: ExecutionActionV1): ExecutionSession {
  const recovery = session.recovery;
  if (!recovery || recovery.state !== "ACTUAL_NVDAB_REDEEMED" || !recovery.redeemSettlement ||
      action.stage !== "EXIT_SWAP" && action.stage !== "EXIT_APPROVAL" ||
      !sameAddress(quote.from, NVDAB_ADDRESS) || !sameAddress(quote.to, USDT_ADDRESS) ||
      quote.inputRaw !== recovery.redeemSettlement.actualAmountOutRaw || quote.quoteId !== action.planIdentity ||
      action.amountInRaw !== recovery.redeemSettlement.actualAmountOutRaw ||
      Date.parse(quote.observedAt) <= Date.parse(recovery.redeemSettlement.confirmedAt)) throw new Error("FRESH_EXIT_QUOTE_REQUIRED");
  return { ...session, recovery: { ...recovery, state: "EXIT_REVIEW_READY", freshExitQuote: quote },
    events: [...session.events, { kind: "EXIT_REVIEWED", observedAt: new Date().toISOString() }] };
}

export function recordRecoveredUsdt(session: ExecutionSession, evidence: SettlementEvidence): ExecutionSession {
  const recovery = session.recovery;
  if (!recovery || recovery.state !== "EXIT_CONFIRMED" || !recovery.redeemSettlement ||
      !sameAddress(evidence.outputToken, USDT_ADDRESS) || !sameAddress(evidence.outputRecipient, session.owner) ||
      evidence.actualAmountInRaw !== recovery.redeemSettlement.actualAmountOutRaw || !/^[1-9]\d*$/.test(evidence.actualAmountOutRaw))
    throw new Error("CANONICAL_EXIT_SETTLEMENT_REQUIRED");
  return { ...session, recovery: { ...recovery, state: "ACTUAL_USDT_RECOVERED", recoveryState: "RECOVERED_AS_USDT", exitSettlement: evidence },
    events: [...session.events, { kind: "ACTUAL_USDT_RECOVERED", observedAt: evidence.confirmedAt }] };
}

export function reserveRecoveryConfirmation(session: ExecutionSession, stage: ExecutionActionV1["stage"]): ExecutionSession {
  const recovery = session.recovery;
  if (!recovery) throw new Error("RECOVERY_NOT_READY");
  if (stage === "VENUS_REDEEM" && recovery.state === "REDEEM_REVIEW_READY")
    return { ...session, recovery: { ...recovery, state: "REDEEM_CONFIRMATION_RESERVED" } };
  if ((stage === "EXIT_APPROVAL" || stage === "EXIT_SWAP") && recovery.state === "EXIT_REVIEW_READY")
    return { ...session, recovery: { ...recovery, state: "EXIT_CONFIRMATION_RESERVED" } };
  throw new Error("RECOVERY_CONFIRMATION_NOT_READY");
}

export function submitRecoveryAction(session: ExecutionSession, action: ExecutionActionV1, observation: TransactionObservation): ExecutionSession {
  const recovery = session.recovery;
  if (!recovery || observation.status !== "SUBMITTED") throw new Error("RECOVERY_ACTION_NOT_RESERVED");
  if (action.stage === "VENUS_REDEEM" && recovery.state === "REDEEM_CONFIRMATION_RESERVED")
    return { ...session, submitted: { ...session.submitted, VENUS_REDEEM: observation }, recovery: { ...recovery, state: "REDEEM_SUBMITTED" } };
  if (action.stage === "EXIT_APPROVAL" && recovery.state === "EXIT_CONFIRMATION_RESERVED")
    return { ...session, submitted: { ...session.submitted, EXIT_APPROVAL: observation }, recovery: { ...recovery, state: "EXIT_SUBMITTED" } };
  if (action.stage === "EXIT_SWAP" && (recovery.state === "EXIT_CONFIRMATION_RESERVED" || recovery.state === "EXIT_REVIEW_READY"))
    return { ...session, submitted: { ...session.submitted, EXIT_SWAP: observation }, recovery: { ...recovery, state: "EXIT_SUBMITTED" } };
  throw new Error("RECOVERY_ACTION_NOT_RESERVED");
}

export function observeRecoveryAction(session: ExecutionSession, action: ExecutionActionV1, observation: TransactionObservation): ExecutionSession {
  const recovery = session.recovery;
  const prior = session.submitted[action.stage as keyof ExecutionSession["submitted"]];
  if (!recovery || !prior || prior.transactionHash.toLowerCase() !== observation.transactionHash.toLowerCase()) throw new Error("UNKNOWN_RECOVERY_TRANSACTION");
  if (observation.status === "FAILED") return { ...session, submitted: { ...session.submitted, [action.stage]: observation }, recovery: { ...recovery, state: "FAILED" } };
  if (observation.status === "PENDING") {
    const state = action.stage === "VENUS_REDEEM" ? "REDEEM_PENDING" : "EXIT_PENDING";
    return { ...session, submitted: { ...session.submitted, [action.stage]: observation }, recovery: { ...recovery, state } };
  }
  if (action.stage === "VENUS_REDEEM" && ["REDEEM_SUBMITTED", "REDEEM_PENDING"].includes(recovery.state))
    return { ...session, submitted: { ...session.submitted, VENUS_REDEEM: observation }, recovery: { ...recovery, state: "REDEEM_CONFIRMED" } };
  if (action.stage === "EXIT_APPROVAL" && ["EXIT_SUBMITTED", "EXIT_PENDING"].includes(recovery.state))
    return { ...session, submitted: { ...session.submitted, EXIT_APPROVAL: observation }, recovery: { ...recovery, state: "EXIT_REVIEW_READY" } };
  if (action.stage === "EXIT_SWAP" && ["EXIT_SUBMITTED", "EXIT_PENDING"].includes(recovery.state))
    return { ...session, submitted: { ...session.submitted, EXIT_SWAP: observation }, recovery: { ...recovery, state: "EXIT_CONFIRMED" } };
  throw new Error("INVALID_RECOVERY_TRANSITION");
}

export function recoveryAfterProductStop(session: ExecutionSession): RecoveryState | null {
  if (session.stage === "PARTIAL_ROUTE_STOPPED" && session.leg1Settlement) return "RECOVERABLE_AS_USDT";
  if (session.leg2Settlement && !session.recovery) return "RECOVERABLE_AS_NVDAB";
  return session.recovery?.recoveryState ?? null;
}
