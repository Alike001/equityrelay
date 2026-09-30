import { NVDAON_ADDRESS, sameAddress, USDT_ADDRESS } from "@/domain/routing/identity";
import type { ExecutionActionV1 } from "./action";
import type { ExecutionReview, ExecutionSession, SettlementEvidence, TransactionObservation } from "@/types/execution";
import type { QuoteSnapshot } from "@/types/route";

export function prepareTestSetup(session: ExecutionSession, quote: QuoteSnapshot, review: ExecutionReview): ExecutionSession {
  if (session.stage !== "ROUTE_POLICY_PASS" || session.testSetup || review.boundary !== "TEST_SETUP" || review.action.kind !== "SWAP" ||
      !sameAddress(quote.from, USDT_ADDRESS) || !sameAddress(quote.to, NVDAON_ADDRESS) || quote.inputRaw !== review.action.amountInRaw ||
      !quote.quoteId || BigInt(quote.outputRaw) < BigInt(session.originalSourceRaw)) throw new Error("TEST_SETUP_REVIEW_INVALID");
  return { ...session, testSetup: { state: "SETUP_REVIEW_READY", quote, review, settlement: null },
    reviews: { ...session.reviews, TEST_SETUP: review }, events: [...session.events, { kind: "TEST_SETUP_REVIEWED", observedAt: new Date().toISOString() }] };
}
export function reserveTestSetup(session: ExecutionSession): ExecutionSession {
  if (session.testSetup?.state !== "SETUP_REVIEW_READY") throw new Error("TEST_SETUP_NOT_READY");
  return { ...session, testSetup: { ...session.testSetup, state: "SETUP_CONFIRMATION_RESERVED" } };
}
export function submitTestSetup(session: ExecutionSession, action: ExecutionActionV1, observation: TransactionObservation): ExecutionSession {
  if (!session.testSetup || session.testSetup.state !== "SETUP_CONFIRMATION_RESERVED" || observation.status !== "SUBMITTED" ||
      !action.stage.startsWith("TEST_SETUP_")) throw new Error("TEST_SETUP_NOT_RESERVED");
  return { ...session, submitted: { ...session.submitted, [action.stage]: observation }, testSetup: { ...session.testSetup, state: "SETUP_SUBMITTED" } };
}
export function observeTestSetup(session: ExecutionSession, action: ExecutionActionV1, observation: TransactionObservation): ExecutionSession {
  if (!session.testSetup || !action.stage.startsWith("TEST_SETUP_")) throw new Error("TEST_SETUP_NOT_SUBMITTED");
  if (observation.status === "FAILED") return { ...session, testSetup: { ...session.testSetup, state: "FAILED" } };
  if (observation.status === "PENDING") return { ...session, testSetup: { ...session.testSetup, state: "SETUP_PENDING" } };
  return { ...session, submitted: { ...session.submitted, [action.stage]: observation }, testSetup: { ...session.testSetup, state: "SETUP_CONFIRMED" } };
}
export function verifyTestSetupSettlement(session: ExecutionSession, evidence: SettlementEvidence): ExecutionSession {
  if (!session.testSetup || session.testSetup.state !== "SETUP_CONFIRMED" || !sameAddress(evidence.outputToken, NVDAON_ADDRESS) ||
      !sameAddress(evidence.outputRecipient, session.owner) || evidence.actualAmountInRaw !== session.testSetup.quote.inputRaw ||
      BigInt(evidence.actualAmountOutRaw) < BigInt(session.originalSourceRaw)) throw new Error("TEST_SETUP_CANONICAL_SETTLEMENT_REQUIRED");
  return { ...session, testSetup: { ...session.testSetup, state: "NVDAON_VERIFIED", settlement: evidence },
    events: [...session.events, { kind: "TEST_SETUP_NVDAON_VERIFIED", observedAt: evidence.confirmedAt }] };
}
