import { sameAddress } from "@/domain/routing/identity";
import type { ExecutionSession } from "@/types/execution";
import type { ExecutionActionV1 } from "./action";

export function requireStepOrder(session: ExecutionSession, action: ExecutionActionV1, confirmedStages: ReadonlySet<string>): void {
  if (session.id !== action.routeId || !sameAddress(session.owner, action.from)) throw new Error("ROUTE_WALLET_MISMATCH");
  if (action.stage === "VENUS_REDEEM") {
    if (!session.recovery || session.recovery.state !== "REDEEM_REVIEW_READY" || !confirmedStages.has("VENUS_DEPOSIT") ||
        action.kind !== "REDEEM" || action.amountInRaw !== session.recovery.venusPosition.vTokenAmountRaw)
      throw new Error("VERIFIED_VENUS_POSITION_REQUIRED");
    return;
  }
  if (action.stage.startsWith("EXIT_")) {
    if (!session.recovery || session.recovery.state !== "EXIT_REVIEW_READY" || !session.recovery.redeemSettlement ||
        !confirmedStages.has("VENUS_REDEEM") || action.amountInRaw !== session.recovery.redeemSettlement.actualAmountOutRaw ||
        action.planIdentity !== session.recovery.freshExitQuote?.quoteId) throw new Error("ACTUAL_REDEEMED_NVDAB_REQUIRED");
    if (action.kind === "APPROVAL" && (!action.approvalAmountRaw || action.approvalAmountRaw !== action.amountInRaw))
      throw new Error("BOUNDED_APPROVAL_REQUIRED");
    if (action.kind === "SWAP" && !confirmedStages.has("EXIT_APPROVAL")) {
      const review = session.reviews.EXIT_TO_USDT;
      if (!review?.allowanceSufficient) throw new Error("APPROVAL_CONFIRMATION_REQUIRED");
    }
    return;
  }
  if (action.stage.startsWith("TEST_SETUP_")) {
    if (session.stage !== "ROUTE_POLICY_PASS" || session.testSetup?.state !== "SETUP_REVIEW_READY" ||
        action.amountInRaw !== session.testSetup.quote.inputRaw || action.planIdentity !== session.testSetup.quote.quoteId)
      throw new Error("TEST_SETUP_SEPARATE_REVIEW_REQUIRED");
    if (action.kind === "APPROVAL" && (session.testSetup.review.allowanceSufficient ||
        action.approvalAmountRaw !== action.amountInRaw || !sameAddress(action.approvalSpender ?? "", session.testSetup.review.approval?.spender ?? "")))
      throw new Error("BOUNDED_APPROVAL_REQUIRED");
    if (action.kind === "SWAP" && !session.testSetup.review.allowanceSufficient && !confirmedStages.has("TEST_SETUP_APPROVAL"))
      throw new Error("APPROVAL_CONFIRMATION_REQUIRED");
    return;
  }
  const leg1 = action.stage.startsWith("LEG1_");
  const leg2 = action.stage.startsWith("LEG2_");
  const review = session.reviews[leg1 ? "LEAVE_ONDO" : leg2 ? "CHANGE_REPRESENTATION" : "SUPPLY_TO_VENUS"];
  if (!review) throw new Error("REVIEW_REQUIRED");
  if (leg1 && session.stage !== "LEG1_REVIEW" && session.stage !== "LEG1_APPROVAL_CONFIRMED") throw new Error("LEG1_REVIEW_REQUIRED");
  if (leg2 && (!session.leg1Settlement || session.policyRecheck !== "PASS" || !session.freshLeg2 ||
      !["LEG2_REVIEW", "LEG2_APPROVAL_CONFIRMED"].includes(session.stage))) throw new Error("FRESH_SETTLED_LEG2_REQUIRED");
  if (!leg1 && !leg2 && (!session.leg2Settlement || !session.venus?.investable ||
      !["VENUS_REVIEW", "VENUS_APPROVAL_CONFIRMED"].includes(session.stage))) throw new Error("SETTLED_VENUS_REVIEW_REQUIRED");
  if (leg2 && !confirmedStages.has("LEG1_SWAP")) throw new Error("CONFIRMED_LEG1_STEP_REQUIRED");
  if (!leg1 && !leg2 && !confirmedStages.has("LEG2_SWAP")) throw new Error("CONFIRMED_LEG2_STEP_REQUIRED");
  const expectedRaw = leg1 ? session.originalSourceRaw : leg2 ? session.leg1Settlement!.actualAmountOutRaw : session.leg2Settlement!.actualAmountOutRaw;
  if (action.amountInRaw !== expectedRaw) throw new Error("INDICATIVE_AMOUNT_FORBIDDEN");
  if (leg2 && action.kind === "SWAP" && action.planIdentity !== session.freshLeg2!.quoteId) throw new Error("FRESH_QUOTE_REQUIRED");
  if (leg1 && action.kind === "SWAP" && action.planIdentity !== session.initialQuote.quoteId) throw new Error("SOURCE_QUOTE_MISMATCH");
  if (!leg1 && !leg2 && action.kind === "DEPOSIT" && action.planIdentity !== session.venus!.investmentId) throw new Error("VENUS_REDISCOVERY_REQUIRED");
  if (action.kind === "APPROVAL") {
    if (review.allowanceSufficient || !review.approval || review.approval.status !== "BOUNDED_READY" ||
        action.approvalAmountRaw !== expectedRaw || !sameAddress(action.approvalSpender ?? "", review.approval.spender))
      throw new Error("BOUNDED_APPROVAL_REQUIRED");
  } else {
    const preceding = leg1 ? "LEG1_APPROVAL" : leg2 ? "LEG2_APPROVAL" : "VENUS_APPROVAL";
    if (!review.allowanceSufficient && !confirmedStages.has(preceding)) throw new Error("APPROVAL_CONFIRMATION_REQUIRED");
  }
}
