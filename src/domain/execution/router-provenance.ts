export type RouterProvenanceClassification =
  | "VERIFIED_PROVENANCE"
  | "API_PROVENANCE_ONLY"
  | "UNRESOLVED";

export type RouterSecurityDecision =
  | "ROUTER_AUTHORIZATION_ACCEPTABLE"
  | "SECURITY_REFUSED_UNVERIFIED_ROUTER";

export type RouterDecisionEnforcement = "RECORDED_OPERATOR_DECISION";

export type RouterBuildEvidence = {
  route: string;
  quoteId: string;
  provider: string;
  executionMode: "SWAP";
  transactionTarget: `0x${string}`;
  approvalSpender: `0x${string}`;
  approvalToken: string;
  approvalAmount: string;
};

export function routerSecurityDecision(
  classification: RouterProvenanceClassification,
): RouterSecurityDecision {
  return classification === "VERIFIED_PROVENANCE"
    ? "ROUTER_AUTHORIZATION_ACCEPTABLE"
    : "SECURITY_REFUSED_UNVERIFIED_ROUTER";
}

export const ROUTER_PROVENANCE_EVIDENCE = {
  observedAt: "2026-10-08T09:23:26.054Z",
  chainId: 56,
  router: "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5" as const,
  runtimeBytecodeHash:
    "0xb6f35276cf3608595df59a3cfa5fb06a3309e64e387b0ea4f60875fdc4c696a0",
  classification: "API_PROVENANCE_ONLY" as const,
  decision: "SECURITY_REFUSED_UNVERIFIED_ROUTER" as const,
  decisionEnforcement: "RECORDED_OPERATOR_DECISION" as const,
  approvalPolicy: "EXACT_BOUNDED" as const,
  walletWarning: "HIGH_RISK_UNVERIFIED_CONTRACT" as const,
  contractArchitecture: "ERC_2535_DIAMOND" as const,
  bscSourceVerified: false,
  facetsSourceVerified: false,
  publishedDeploymentRegistryFound: false,
  deploymentSpecificAuditFound: false,
  approvalReviewRequested: true,
  approvalCancelledByUser: true,
  approvalSigned: false,
  transactionBroadcast: false,
  allowanceConfirmedOnchain: false,
  builds: [
    {
      route: "USDT → NVDAon",
      quoteId: "730ceb4f6a67417c8ec27c85e7e45188",
      provider: "LiquidMesh",
      executionMode: "SWAP",
      transactionTarget: "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5",
      approvalSpender: "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5",
      approvalToken: "USDT",
      approvalAmount: "5.21 USDT",
    },
    {
      route: "NVDAon → USDT",
      quoteId: "fd29bb18ab1e401c9ecf16524a900c42",
      provider: "LiquidMesh",
      executionMode: "SWAP",
      transactionTarget: "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5",
      approvalSpender: "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5",
      approvalToken: "NVDAon",
      approvalAmount: "0.022 NVDAon",
    },
    {
      route: "USDT → NVDAB",
      quoteId: "51826ea755c94c5c89dcaa27771f9072",
      provider: "LiquidMesh",
      executionMode: "SWAP",
      transactionTarget: "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5",
      approvalSpender: "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5",
      approvalToken: "USDT",
      approvalAmount: "5.195124714149892188 USDT",
    },
  ] satisfies RouterBuildEvidence[],
} as const;
