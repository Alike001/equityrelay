import "server-only";
import { executionActionV1 } from "@/domain/execution/action";
import { getExecutionRoute, createExecutionStep } from "./repository";
import type { Address } from "@/types/route";

export async function prepareDependentAction(routeId: string, wallet: Address) {
  const stored = await getExecutionRoute(routeId, wallet);
  if (!stored) throw new Error("ROUTE_NOT_FOUND");
  const setupApprovalConfirmed = stored.session.testSetup?.state === "SETUP_REVIEW_READY" && stored.session.submitted.TEST_SETUP_APPROVAL?.status === "CONFIRMED";
  const mapping = setupApprovalConfirmed ? { boundary: "TEST_SETUP" as const, stage: "TEST_SETUP_SWAP" as const, identity: stored.session.testSetup?.quote.quoteId } :
    stored.state === "LEG1_APPROVAL_CONFIRMED" ? { boundary: "LEAVE_ONDO" as const, stage: "LEG1_SWAP" as const, identity: stored.session.initialQuote.quoteId } :
    stored.state === "LEG2_APPROVAL_CONFIRMED" ? { boundary: "CHANGE_REPRESENTATION" as const, stage: "LEG2_SWAP" as const, identity: stored.session.freshLeg2?.quoteId } :
    stored.state === "VENUS_APPROVAL_CONFIRMED" ? { boundary: "SUPPLY_TO_VENUS" as const, stage: "VENUS_DEPOSIT" as const, identity: stored.session.venus?.investmentId } : null;
  const exitApprovalConfirmed = stored.session.recovery?.state === "EXIT_REVIEW_READY" && stored.session.submitted.EXIT_APPROVAL?.status === "CONFIRMED";
  const selected = mapping ?? (exitApprovalConfirmed ? { boundary: "EXIT_TO_USDT" as const, stage: "EXIT_SWAP" as const,
    identity: stored.session.recovery?.freshExitQuote?.quoteId } : null);
  if (!selected?.identity) throw new Error("DEPENDENT_ACTION_NOT_READY");
  const review = stored.session.reviews[selected.boundary];
  if (!review || review.allowanceSufficient || review.action.kind !== (selected.stage === "VENUS_DEPOSIT" ? "DEPOSIT" : "SWAP"))
    throw new Error("DEPENDENT_ACTION_NOT_READY");
  const step = await createExecutionStep(routeId, wallet, stored.version,
    executionActionV1({ routeId, stage: selected.stage, action: review.action, planIdentity: selected.identity }),
    { quote: review.quote ? { quoteId: review.quote.quoteId, observedAt: review.quote.observedAt, expiresAt: review.quote.expiresAt, inputRaw: review.quote.inputRaw } : undefined,
      gas: { gasLimit: review.action.gasLimit, gasPrice: review.action.gasPrice, maxFeePerGas: review.action.maxFeePerGas,
        maxPriorityFeePerGas: review.action.maxPriorityFeePerGas } });
  return { state: stored.session.recovery?.state ?? stored.state, stepId: step.id, stage: step.stage, actionHash: step.actionHash, executionArmed: false };
}
