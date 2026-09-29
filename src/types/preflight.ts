import type { Address, BrowserIntent, RouteDecision } from "./route";

export type SimulationStatus = "PASSED" | "FAILED" | "BLOCKED_BY_WALLET_STATE" | "UNAVAILABLE";
export type BuildStatus = "READY" | "UNAVAILABLE";
export type TransactionAction = "APPROVAL" | "SWAP" | "RFQ" | "DEPOSIT";

export type SimulationResult = {
  status: SimulationStatus;
  failReason: string | null;
  balanceChanges: Array<{ tokenAddress: string; owner: string; change: string }>;
  allowanceChanges: Array<{ tokenAddress: string; owner: string; spender: string; before: string; after: string }>;
  warnings: string[];
};

export type PreflightAction = {
  kind: TransactionAction;
  chainId: 56;
  from: Address;
  to: Address | null;
  valueWei: string | null;
  calldataSummary: string;
  rawCalldata: string | null;
  gasLimit: string | null;
  gasPrice: string | null;
  maxPriorityFeePerGas: string | null;
  maxFeePerGas: string | null;
  tokenIn: Address;
  tokenOut: Address | null;
  amountInRaw: string;
  minAmountOutRaw: string | null;
  amountInHuman: string | null;
  minAmountOutHuman: string | null;
  slippagePercent: string | null;
  tokenInLabel: string;
  tokenOutLabel: string | null;
  approvalSpender: Address | null;
  approvalAmountRaw: string | null;
  approvalExceedsInput: boolean;
  simulation: SimulationResult;
};

export type PreflightStage = {
  label: string;
  indicative: boolean;
  buildStatus: BuildStatus;
  actions: PreflightAction[];
  simulationStatus: SimulationStatus;
  reason: string | null;
  previewDetails: {
    balanceChanges: Array<{ tokenSymbol: string; amount: string; valueUsd: string | null }>;
    estimatedNetworkFee: string | null;
    healthFactorBefore: string | null;
    healthFactorAfter: string | null;
  } | null;
};

export type RoutePreflight = {
  kind: "preflight";
  routePolicy: "PASS";
  routePreview: Pick<RouteDecision, "amount" | "maxExposureLossBps" | "sourceShares" | "targetShares" | "retentionPercent" | "exposureLossPercent" | "observedAt">;
  leg1: PreflightStage;
  leg2Indicative: PreflightStage;
  venusDepositIndicative: PreflightStage;
  overallPreflightState: "READY_TO_REVIEW" | "WALLET_STATE_BLOCKED" | "UNAVAILABLE" | "BLOCKED";
  safetyWarnings: string[];
  observedAt: string;
};

export type PreflightRefusal = {
  kind: "refusal";
  routePolicy: "BLOCKED" | "UNAVAILABLE";
  overallPreflightState: "BLOCKED" | "UNAVAILABLE";
  reason: string;
};

export type PreflightResult = RoutePreflight | PreflightRefusal;
export type PreflightIntent = BrowserIntent;
