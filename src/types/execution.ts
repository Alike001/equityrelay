import type { Address, BrowserIntent, DestinationSnapshot, QuoteSnapshot, RepresentationSnapshot } from "./route";
import type { AuthorizationReview, PreflightAction, SimulationStatus } from "./preflight";

export type ExecutionLeg = "LEG1" | "LEG2" | "VENUS";
export type ConfirmationBoundary = "TEST_SETUP" | "LEAVE_ONDO" | "CHANGE_REPRESENTATION" | "SUPPLY_TO_VENUS" | "REDEEM_VENUS" | "EXIT_TO_USDT";
export type ProductConfirmationBoundary = Extract<ConfirmationBoundary, "LEAVE_ONDO" | "CHANGE_REPRESENTATION" | "SUPPLY_TO_VENUS">;
export type RecoveryState = "RECOVERABLE_AS_USDT" | "RECOVERABLE_AS_NVDAB" | "RECOVERABLE_FROM_VENUS" | "RECOVERED_AS_USDT";
export type ChainTransactionStatus = "SUBMITTED" | "PENDING" | "CONFIRMED" | "FAILED";
export type ExecutionStage = "ROUTE_POLICY_PASS" | "LEG1_REVIEW" | "LEG1_APPROVAL_PENDING" | "LEG1_APPROVAL_CONFIRMED" | "LEG1_SWAP_PENDING" | "LEG1_CONFIRMED" | "ACTUAL_USDT_MEASURED" | "LEG2_REQUOTED" | "POLICY_RECHECKED" | "PARTIAL_ROUTE_STOPPED" | "LEG2_REVIEW" | "LEG2_APPROVAL_PENDING" | "LEG2_APPROVAL_CONFIRMED" | "LEG2_SWAP_PENDING" | "LEG2_CONFIRMED" | "ACTUAL_NVDAB_MEASURED" | "VENUS_REDISCOVERED" | "VENUS_REVIEW" | "VENUS_APPROVAL_PENDING" | "VENUS_APPROVAL_CONFIRMED" | "VENUS_DEPOSIT_PENDING" | "VENUS_CONFIRMED" | "VERIFIED_RECEIPT" | "FAILED";
export type TokenTransfer = { token: Address; from: Address; to: Address; amountRaw: string; logIndex: number | null };
export type ConfirmedTransaction = { status: "CONFIRMED"; transactionHash: `0x${string}`; blockNumber: string; from: Address; to: Address; tokenTransfers: TokenTransfer[]; confirmedAt: string };
export type PendingTransaction = { status: "SUBMITTED" | "PENDING" | "FAILED"; transactionHash: `0x${string}`; reason?: string };
export type TransactionObservation = ConfirmedTransaction | PendingTransaction;
export type SettlementEvidence = ConfirmedTransaction & { actualAmountInRaw: string; actualAmountOutRaw: string; outputToken: Address; outputRecipient: Address };
export type ExecutionReview = { boundary: ConfirmationBoundary; approval: AuthorizationReview | null; allowanceSufficient: boolean; action: PreflightAction; simulation: SimulationStatus; createdAt: string; quote: QuoteSnapshot | null; destination: DestinationSnapshot | null };
export type ExecutionSession = {
  id: string; owner: Address; intent: BrowserIntent; stage: ExecutionStage; originalSource: RepresentationSnapshot; originalSourceRaw: string;
  sourceShares: string; initialQuote: QuoteSnapshot; initialLeg2Indicative: QuoteSnapshot;
  reviews: Partial<Record<ConfirmationBoundary, ExecutionReview>>; confirmations: ConfirmationBoundary[];
  submitted: Partial<Record<"TEST_SETUP_APPROVAL" | "TEST_SETUP_SWAP" | "LEG1_APPROVAL" | "LEG1_SWAP" | "LEG2_APPROVAL" | "LEG2_SWAP" |
    "VENUS_APPROVAL" | "VENUS_DEPOSIT" | "VENUS_REDEEM" | "EXIT_APPROVAL" | "EXIT_SWAP", TransactionObservation>>;
  leg1Settlement: SettlementEvidence | null; leg2Settlement: SettlementEvidence | null;
  freshLeg2: QuoteSnapshot | null; freshTarget: RepresentationSnapshot | null; venus: DestinationSnapshot | null;
  policyRecheck: "PASS" | "PARTIAL_ROUTE_STOPPED" | null;
  testSetup: { state: "SETUP_REVIEW_READY" | "SETUP_CONFIRMATION_RESERVED" | "SETUP_SUBMITTED" | "SETUP_PENDING" | "SETUP_CONFIRMED" | "NVDAON_VERIFIED" | "FAILED";
    quote: QuoteSnapshot; review: ExecutionReview; settlement: SettlementEvidence | null } | null;
  recovery: {
    state: "VENUS_POSITION_VERIFIED" | "REDEEM_REVIEW_READY" | "REDEEM_CONFIRMATION_RESERVED" | "REDEEM_AWAITING_WALLET_TX" |
      "REDEEM_SUBMITTED" | "REDEEM_PENDING" | "REDEEM_CONFIRMED" | "ACTUAL_NVDAB_REDEEMED" | "EXIT_REVIEW_READY" |
      "EXIT_CONFIRMATION_RESERVED" | "EXIT_AWAITING_WALLET_TX" | "EXIT_SUBMITTED" | "EXIT_PENDING" | "EXIT_CONFIRMED" |
      "ACTUAL_USDT_RECOVERED" | "FAILED";
    recoveryState: RecoveryState;
    venusPosition: { market: Address; investmentId: string; underlyingAmountRaw: string; vTokenAmountRaw: string; transactionHash: `0x${string}`; blockNumber: string };
    redeemExpectedUnderlyingRaw: string | null;
    redeemSettlement: SettlementEvidence | null;
    freshExitQuote: QuoteSnapshot | null;
    exitSettlement: SettlementEvidence | null;
  } | null;
  events: Array<{ kind: string; observedAt: string; reason?: string }>;
};
export type VerifiedExecutionReceipt = {
  id: string; status: "VERIFIED"; createdAt: string; intent: BrowserIntent;
  quoted: { initialLeg1: QuoteSnapshot; indicativeLeg2: QuoteSnapshot; freshLeg2: QuoteSnapshot };
  actual: { leg1: SettlementEvidence; leg2: SettlementEvidence; venusDeposit: ConfirmedTransaction; startingShares: string; finalShares: string; realizedRetentionPercent: string };
  route: { source: RepresentationSnapshot; settlementAsset: Address; target: RepresentationSnapshot; destination: DestinationSnapshot };
  approvals: AuthorizationReview[]; transactionHashes: `0x${string}`[]; confirmationBlocks: string[];
  events: ExecutionSession["events"];
};
