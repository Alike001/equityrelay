export type Address = `0x${string}`;
export type ReasonCode =
  | "PASS_ROUTE_READY"
  | "BLOCK_EXPOSURE_POLICY"
  | "BLOCK_SOURCE_STATUS"
  | "BLOCK_TARGET_STATUS"
  | "BLOCK_DESTINATION_NOT_INVESTABLE"
  | "BLOCK_NO_LEG1_QUOTE"
  | "BLOCK_NO_LEG2_QUOTE"
  | "UNAVAILABLE_API"
  | "INVALID_EVIDENCE"
  | "PARTIAL_ROUTE_STOPPED";

export type BrowserIntent = {
  underlying: "NVDA";
  sourceRepresentation: "ondo";
  amount: string;
  destination: "venus";
  maxExposureLossBps: number;
  takerAddress: Address;
};

export type RepresentationSnapshot = {
  chainId: 56;
  underlying: "NVDA";
  issuer: "ondo" | "bstock";
  symbol: "NVDAon" | "NVDAB";
  address: Address;
  decimals: number;
  tokenToShareRatio: string;
  open: boolean;
  observedAt: string;
};

export type QuoteSnapshot = {
  leg: 1 | 2;
  from: Address;
  to: Address;
  inputRaw: string;
  outputRaw: string;
  vendor: string | null;
  quoteId: string | null;
  tradeFeeUsd: string | null;
  priceImpactPercent: string | null;
  observedAt: string;
  expiresAt: string | null;
};

export type DestinationSnapshot = {
  protocol: "Venus";
  chainId: 56;
  investmentId: string;
  assetAddress: Address;
  investable: boolean;
  observedAt: string;
};

export type RouteEvidence = {
  source: RepresentationSnapshot;
  target: RepresentationSnapshot;
  destination: DestinationSnapshot;
  leg1: QuoteSnapshot;
  leg2: QuoteSnapshot;
  sourceRaw: string;
};

export type RouteDecision = {
  kind: "decision";
  state: "PASS" | "BLOCKED";
  reasons: ReasonCode[];
  amount: string;
  maxExposureLossBps: number;
  sourceShares: string;
  targetShares: string;
  retentionPercent: string;
  exposureLossPercent: string;
  observedAt: string;
  expiresAt: string | null;
  evidence: RouteEvidence;
};

export type RouteUnavailable = {
  kind: "unavailable";
  state: "UNAVAILABLE";
  reasons: ReasonCode[];
  message: string;
};

export type PreviewResult = RouteDecision | RouteUnavailable;
