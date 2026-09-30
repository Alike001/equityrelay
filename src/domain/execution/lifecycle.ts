import Decimal from "decimal.js";
import { decimalText, normalizedShares } from "@/domain/exposure/decimal";
import { recheckLeg2AfterLeg1 } from "@/domain/policy/evaluate";
import { NVDAB_ADDRESS, sameAddress, USDT_ADDRESS, validateDestination, validateRepresentation } from "@/domain/routing/identity";
import type { AuthorizationReview } from "@/types/preflight";
import type { Address, DestinationSnapshot, QuoteSnapshot, RepresentationSnapshot, RouteDecision } from "@/types/route";
import type { ProductConfirmationBoundary, ConfirmedTransaction, ExecutionReview, ExecutionSession, ExecutionStage, SettlementEvidence, TransactionObservation, VerifiedExecutionReceipt } from "@/types/execution";

const raw = /^[1-9]\d*$/;
const txHash = /^0x[a-fA-F0-9]{64}$/;
function advance(session: ExecutionSession, stage: ExecutionStage, kind: string, reason?: string): ExecutionSession {
  return { ...session, stage, events: [...session.events, { kind, observedAt: new Date().toISOString(), ...(reason ? { reason } : {}) }] };
}
function at(session: ExecutionSession, stage: ExecutionStage): void { if (session.stage !== stage) throw new Error("INVALID_EXECUTION_TRANSITION"); }
function exactApproval(review: AuthorizationReview | null, token: Address, amountRaw: string): void {
  if (!review || review.status !== "BOUNDED_READY" || review.scope !== "EXACT" || !sameAddress(review.token, token) ||
      review.requestedAmountRaw !== amountRaw || review.allowedAmountRaw !== amountRaw || !review.spender) throw new Error("AUTHORIZATION_NOT_BOUNDED");
}
function assertConfirmed(observation: TransactionObservation, expectedHash: string): asserts observation is ConfirmedTransaction {
  if (observation.status === "FAILED") throw new Error("TRANSACTION_FAILED");
  if (observation.status !== "CONFIRMED" || observation.transactionHash.toLowerCase() !== expectedHash.toLowerCase() ||
      !raw.test(observation.blockNumber) || !Number.isFinite(Date.parse(observation.confirmedAt))) throw new Error("CONFIRMED_RECEIPT_REQUIRED");
}
function reviewAction(review: ExecutionReview, owner: Address, token: Address, amountRaw: string, target: Address | null, quote: QuoteSnapshot | null): void {
  if (review.action.chainId !== 56 || !sameAddress(review.action.from, owner) || !review.action.to || !review.action.rawCalldata ||
      review.action.valueWei !== "0" || !sameAddress(review.action.tokenIn, token) || review.action.amountInRaw !== amountRaw ||
      (target && !sameAddress(review.action.tokenOut ?? "", target)) ||
      review.action.simulation.status === "FAILED" || review.action.simulation.status === "UNAVAILABLE") throw new Error("INVALID_EXECUTION_REVIEW");
  if (review.action.kind !== (review.boundary === "SUPPLY_TO_VENUS" ? "DEPOSIT" : "SWAP")) throw new Error("INVALID_EXECUTION_REVIEW");
  if (quote && (review.quote?.quoteId !== quote.quoteId || review.quote.inputRaw !== amountRaw ||
      !review.action.minAmountOutRaw || BigInt(review.action.minAmountOutRaw) > BigInt(quote.outputRaw) ||
      quote.expiresAt && Date.parse(quote.expiresAt) <= Date.now())) throw new Error("STALE_OR_MISMATCHED_QUOTE");
  if (!review.allowanceSufficient) exactApproval(review.approval, token, amountRaw);
  if (!review.allowanceSufficient && !sameAddress(review.approval!.spender, review.action.to)) throw new Error("APPROVAL_SPENDER_MISMATCH");
}

export function beginExecutionSession(id: string, owner: Address, preview: RouteDecision): ExecutionSession {
  if (preview.state !== "PASS" || !id || !sameAddress(preview.evidence.leg1.from, preview.evidence.source.address) ||
      !sameAddress(preview.evidence.leg1.to, USDT_ADDRESS) || !sameAddress(preview.evidence.leg2.from, USDT_ADDRESS) ||
      preview.evidence.leg1.outputRaw !== preview.evidence.leg2.inputRaw) throw new Error("ROUTE_POLICY_PASS_REQUIRED");
  validateRepresentation(preview.evidence.source, "source");
  validateRepresentation(preview.evidence.target, "target");
  return { id, owner, intent: { underlying: "NVDA", sourceRepresentation: "ondo", amount: preview.amount, destination: "venus", maxExposureLossBps: preview.maxExposureLossBps, takerAddress: owner },
    stage: "ROUTE_POLICY_PASS", originalSource: preview.evidence.source, originalSourceRaw: preview.evidence.sourceRaw, sourceShares: preview.sourceShares,
    initialQuote: preview.evidence.leg1, initialLeg2Indicative: preview.evidence.leg2, reviews: {}, confirmations: [], submitted: {}, leg1Settlement: null, leg2Settlement: null,
    freshLeg2: null, freshTarget: null, venus: null, policyRecheck: null, testSetup: null, recovery: null, events: [] };
}

export function prepareReview(session: ExecutionSession, review: ExecutionReview): ExecutionSession {
  const boundary = review.boundary;
  if (boundary === "LEAVE_ONDO") {
    at(session, "ROUTE_POLICY_PASS");
    reviewAction(review, session.owner, session.originalSource.address, session.originalSourceRaw, USDT_ADDRESS, session.initialQuote);
    return { ...advance(session, "LEG1_REVIEW", "LEAVE_ONDO_REVIEWED"), reviews: { ...session.reviews, [boundary]: review } };
  }
  if (boundary === "CHANGE_REPRESENTATION") {
    at(session, "POLICY_RECHECKED");
    if (session.policyRecheck !== "PASS" || !session.leg1Settlement || !session.freshLeg2 || !session.freshTarget) throw new Error("FRESH_POLICY_PASS_REQUIRED");
    reviewAction(review, session.owner, USDT_ADDRESS, session.leg1Settlement.actualAmountOutRaw, session.freshTarget.address, session.freshLeg2);
    return { ...advance(session, "LEG2_REVIEW", "CHANGE_REPRESENTATION_REVIEWED"), reviews: { ...session.reviews, [boundary]: review } };
  }
  at(session, "VENUS_REDISCOVERED");
  if (!session.leg2Settlement || !session.venus?.investable || !review.destination || review.destination.investmentId !== session.venus.investmentId)
    throw new Error("FRESH_VENUS_DISCOVERY_REQUIRED");
  reviewAction(review, session.owner, NVDAB_ADDRESS, session.leg2Settlement.actualAmountOutRaw, null, null);
  if (!review.allowanceSufficient && !sameAddress(review.approval!.spender, review.action.to!)) throw new Error("VENUS_TARGET_UNVERIFIED");
  if (review.action.amountInRaw !== session.leg2Settlement.actualAmountOutRaw) throw new Error("ACTUAL_NVDAB_REQUIRED");
  return { ...advance(session, "VENUS_REVIEW", "SUPPLY_TO_VENUS_REVIEWED"), reviews: { ...session.reviews, [boundary]: review } };
}

export function recordConfirmation(session: ExecutionSession, boundary: ProductConfirmationBoundary): ExecutionSession {
  const required = { LEAVE_ONDO: "LEG1_REVIEW", CHANGE_REPRESENTATION: "LEG2_REVIEW", SUPPLY_TO_VENUS: "VENUS_REVIEW" } as const;
  at(session, required[boundary]);
  if (!session.reviews[boundary]) throw new Error("REVIEW_REQUIRED");
  return { ...advance(session, session.stage, `${boundary}_USER_CONFIRMED`), confirmations: [...session.confirmations, boundary] };
}

export function submitPlannedAction(session: ExecutionSession, boundary: ProductConfirmationBoundary, kind: "APPROVAL" | "SWAP" | "DEPOSIT", observation: TransactionObservation): ExecutionSession {
  const plan = { LEAVE_ONDO: { review: "LEG1_REVIEW", approved: "LEG1_APPROVAL_CONFIRMED", approvalPending: "LEG1_APPROVAL_PENDING", actionPending: "LEG1_SWAP_PENDING", approvalKey: "LEG1_APPROVAL", actionKey: "LEG1_SWAP" },
    CHANGE_REPRESENTATION: { review: "LEG2_REVIEW", approved: "LEG2_APPROVAL_CONFIRMED", approvalPending: "LEG2_APPROVAL_PENDING", actionPending: "LEG2_SWAP_PENDING", approvalKey: "LEG2_APPROVAL", actionKey: "LEG2_SWAP" },
    SUPPLY_TO_VENUS: { review: "VENUS_REVIEW", approved: "VENUS_APPROVAL_CONFIRMED", approvalPending: "VENUS_APPROVAL_PENDING", actionPending: "VENUS_DEPOSIT_PENDING", approvalKey: "VENUS_APPROVAL", actionKey: "VENUS_DEPOSIT" } } as const;
  const step = plan[boundary];
  if (!session.confirmations.includes(boundary) || !txHash.test(observation.transactionHash) || observation.status !== "SUBMITTED") throw new Error("CONFIRMED_USER_ACTION_REQUIRED");
  const review = session.reviews[boundary];
  if (!review) throw new Error("REVIEW_REQUIRED");
  if (kind === "APPROVAL") {
    at(session, step.review);
    if (review.allowanceSufficient || !review.approval) throw new Error("APPROVAL_NOT_REQUIRED");
    return { ...advance(session, step.approvalPending, "APPROVAL_SUBMITTED"), submitted: { ...session.submitted, [step.approvalKey]: observation } };
  }
  if (kind !== (boundary === "SUPPLY_TO_VENUS" ? "DEPOSIT" : "SWAP")) throw new Error("WRONG_ACTION_KIND");
  at(session, review.allowanceSufficient ? step.review : step.approved);
  return { ...advance(session, step.actionPending, `${kind}_SUBMITTED`), submitted: { ...session.submitted, [step.actionKey]: observation } };
}

export function observeTransaction(session: ExecutionSession, boundary: ProductConfirmationBoundary, kind: "APPROVAL" | "SWAP" | "DEPOSIT", observation: TransactionObservation): ExecutionSession {
  const prefix = boundary === "LEAVE_ONDO" ? "LEG1" : boundary === "CHANGE_REPRESENTATION" ? "LEG2" : "VENUS";
  const key = `${prefix}_${kind === "DEPOSIT" ? "DEPOSIT" : kind === "SWAP" ? "SWAP" : "APPROVAL"}` as keyof ExecutionSession["submitted"];
  const old = session.submitted[key];
  if (!old || old.transactionHash.toLowerCase() !== observation.transactionHash.toLowerCase()) throw new Error("UNKNOWN_SUBMITTED_TRANSACTION");
  if (observation.status === "FAILED") return { ...advance(session, "FAILED", "TRANSACTION_FAILED", observation.reason), submitted: { ...session.submitted, [key]: observation } };
  if (observation.status === "PENDING") return { ...session, submitted: { ...session.submitted, [key]: observation } };
  assertConfirmed(observation, old.transactionHash);
  const pendingStage = kind === "APPROVAL" ? `${prefix}_APPROVAL_PENDING` : prefix === "VENUS" ? "VENUS_DEPOSIT_PENDING" : `${prefix}_SWAP_PENDING`;
  at(session, pendingStage as ExecutionStage);
  if (!sameAddress(observation.from, session.owner)) throw new Error("RECEIPT_SENDER_MISMATCH");
  const review = session.reviews[boundary];
  const expectedTarget = kind === "APPROVAL" ? review?.approval?.token : review?.action.to;
  if (!expectedTarget || !sameAddress(observation.to, expectedTarget)) throw new Error("RECEIPT_TARGET_MISMATCH");
  const nextStage = kind === "APPROVAL" ? `${prefix}_APPROVAL_CONFIRMED` : `${prefix}_CONFIRMED`;
  return { ...advance(session, nextStage as ExecutionStage, `${kind}_CONFIRMED`), submitted: { ...session.submitted, [key]: observation } };
}

export function measureSettlement(session: ExecutionSession, leg: "LEG1" | "LEG2", evidence: SettlementEvidence): ExecutionSession {
  at(session, `${leg}_CONFIRMED`);
  const submitted = session.submitted[`${leg}_SWAP`];
  if (!submitted) throw new Error("CONFIRMED_RECEIPT_REQUIRED");
  assertConfirmed(evidence, submitted.transactionHash);
  const expectedToken = leg === "LEG1" ? USDT_ADDRESS : NVDAB_ADDRESS;
  const expectedInput = leg === "LEG1" ? session.originalSourceRaw : session.leg1Settlement?.actualAmountOutRaw;
  if (!sameAddress(evidence.outputToken, expectedToken) || !sameAddress(evidence.outputRecipient, session.owner) ||
      !raw.test(evidence.actualAmountInRaw) || evidence.actualAmountInRaw !== expectedInput || !raw.test(evidence.actualAmountOutRaw)) throw new Error("INVALID_SETTLEMENT_EVIDENCE");
  const inputToken = leg === "LEG1" ? session.originalSource.address : USDT_ADDRESS;
  const spent = evidence.tokenTransfers.filter(x => sameAddress(x.token, inputToken) && sameAddress(x.from, session.owner)).reduce((sum, x) => sum + BigInt(x.amountRaw), 0n);
  const received = evidence.tokenTransfers.filter(x => sameAddress(x.token, expectedToken) && sameAddress(x.to, session.owner)).reduce((sum, x) => sum + BigInt(x.amountRaw), 0n);
  if (spent.toString() !== evidence.actualAmountInRaw || received.toString() !== evidence.actualAmountOutRaw) throw new Error("TRANSFER_EVIDENCE_MISMATCH");
  return leg === "LEG1" ? { ...advance(session, "ACTUAL_USDT_MEASURED", "ACTUAL_USDT_MEASURED"), leg1Settlement: evidence }
    : { ...advance(session, "ACTUAL_NVDAB_MEASURED", "ACTUAL_NVDAB_MEASURED"), leg2Settlement: evidence };
}

export function requoteLeg2(session: ExecutionSession, quote: QuoteSnapshot, target: RepresentationSnapshot): ExecutionSession {
  at(session, "ACTUAL_USDT_MEASURED");
  validateRepresentation(target, "target");
  if (!session.leg1Settlement || !quote.quoteId || quote.quoteId === session.initialLeg2Indicative.quoteId || quote.leg !== 2 ||
      !sameAddress(quote.from, USDT_ADDRESS) || !sameAddress(quote.to, target.address) || quote.inputRaw !== session.leg1Settlement.actualAmountOutRaw ||
      Date.parse(quote.observedAt) <= Date.parse(session.leg1Settlement.confirmedAt) || quote.expiresAt && Date.parse(quote.expiresAt) <= Date.now()) throw new Error("FRESH_SETTLED_LEG2_QUOTE_REQUIRED");
  return { ...advance(session, "LEG2_REQUOTED", "LEG2_REQUOTED"), freshLeg2: quote, freshTarget: target };
}

export function recheckPolicy(session: ExecutionSession): ExecutionSession {
  at(session, "LEG2_REQUOTED");
  if (!session.leg1Settlement || !session.freshLeg2 || !session.freshTarget) throw new Error("FRESH_SETTLED_LEG2_QUOTE_REQUIRED");
  const policyRecheck = recheckLeg2AfterLeg1({ originalSource: session.originalSource, originalSourceRaw: session.originalSourceRaw,
    actualUsdtRaw: session.leg1Settlement.actualAmountOutRaw, refreshedTarget: session.freshTarget, refreshedLeg2: session.freshLeg2, maxExposureLossBps: session.intent.maxExposureLossBps });
  return { ...advance(session, policyRecheck === "PASS" ? "POLICY_RECHECKED" : "PARTIAL_ROUTE_STOPPED", policyRecheck), policyRecheck };
}

export function rediscoverVenus(session: ExecutionSession, destination: DestinationSnapshot): ExecutionSession {
  at(session, "ACTUAL_NVDAB_MEASURED");
  validateDestination(destination);
  if (!session.leg2Settlement || !destination.investable || !sameAddress(destination.assetAddress, NVDAB_ADDRESS) ||
      Date.parse(destination.observedAt) <= Date.parse(session.leg2Settlement.confirmedAt)) throw new Error("FRESH_VENUS_DISCOVERY_REQUIRED");
  return { ...advance(session, "VENUS_REDISCOVERED", "VENUS_REDISCOVERED"), venus: destination };
}

export function verifyExecutionReceipt(session: ExecutionSession): VerifiedExecutionReceipt {
  at(session, "VENUS_CONFIRMED");
  const leg1 = session.leg1Settlement, leg2 = session.leg2Settlement, deposit = session.submitted.VENUS_DEPOSIT;
  if (!leg1 || !leg2 || !deposit || !session.freshLeg2 || !session.freshTarget || !session.venus || session.policyRecheck !== "PASS" ||
      session.confirmations.length !== 3) throw new Error("INCOMPLETE_EXECUTION_EVIDENCE");
  assertConfirmed(deposit, deposit.transactionHash);
  for (const key of ["LEG1_SWAP", "LEG2_SWAP", "VENUS_DEPOSIT"] as const) if (session.submitted[key]?.status !== "CONFIRMED") throw new Error("INCOMPLETE_EXECUTION_EVIDENCE");
  const approvals = Object.values(session.reviews).flatMap(x => x?.approval ? [x.approval] : []);
  for (const key of ["LEG1_APPROVAL", "LEG2_APPROVAL", "VENUS_APPROVAL"] as const) {
    const needed = key === "LEG1_APPROVAL" ? session.reviews.LEAVE_ONDO : key === "LEG2_APPROVAL" ? session.reviews.CHANGE_REPRESENTATION : session.reviews.SUPPLY_TO_VENUS;
    if (needed && !needed.allowanceSufficient && session.submitted[key]?.status !== "CONFIRMED") throw new Error("APPROVAL_CONFIRMATION_REQUIRED");
  }
  const finalShares = normalizedShares(leg2.actualAmountOutRaw, session.freshTarget.decimals, session.freshTarget.tokenToShareRatio);
  const startingShares = normalizedShares(session.originalSourceRaw, session.originalSource.decimals, session.originalSource.tokenToShareRatio);
  return { id: session.id, status: "VERIFIED", createdAt: new Date().toISOString(), intent: session.intent,
    quoted: { initialLeg1: session.initialQuote, indicativeLeg2: session.initialLeg2Indicative, freshLeg2: session.freshLeg2 },
    actual: { leg1, leg2, venusDeposit: deposit, startingShares: decimalText(startingShares), finalShares: decimalText(finalShares), realizedRetentionPercent: decimalText(finalShares.div(startingShares).mul(new Decimal(100))) },
    route: { source: session.originalSource, settlementAsset: USDT_ADDRESS, target: session.freshTarget, destination: session.venus },
    approvals, transactionHashes: Object.values(session.submitted).filter((x): x is TransactionObservation => !!x).map(x => x.transactionHash),
    confirmationBlocks: Object.values(session.submitted).filter((x): x is ConfirmedTransaction => x?.status === "CONFIRMED").map(x => x.blockNumber), events: session.events };
}

export function finalizeExecutionReceipt(session: ExecutionSession): { session: ExecutionSession; receipt: VerifiedExecutionReceipt } {
  const receipt = verifyExecutionReceipt(session);
  return { session: advance(session, "VERIFIED_RECEIPT", "VERIFIED_RECEIPT_CREATED"), receipt };
}
