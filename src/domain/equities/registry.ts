import type { Address } from "@/types/route";

export const SUPPORTED_UNDERLYINGS = ["NVDA", "SPCX", "TSLA"] as const;
export type SupportedUnderlying = typeof SUPPORTED_UNDERLYINGS[number];
export type ExecutionVerifierStatus = "VALIDATED" | "NOT_VALIDATED";

export type EquityConfig = {
  underlying: SupportedUnderlying;
  displayName: string;
  shortLabel: string;
  sourceIssuer: "ondo";
  targetIssuer: "bstock";
  settlementSymbol: "USDT";
  destinationProtocol: "Venus";
  sourceSymbol: string;
  targetSymbol: string;
  sourceAddress: Address;
  targetAddress: Address;
  venusMarketAddress: Address;
  routePreviewSupported: true;
  executionVerifierStatus: ExecutionVerifierStatus;
};

// Server-owned allowlist. Live Binance RWA and DeFi data must still agree with
// these identities; ratios, open state, investment IDs and investability are
// never sourced from this registry.
const REGISTRY: Record<SupportedUnderlying, EquityConfig> = {
  NVDA: {
    underlying: "NVDA", displayName: "NVIDIA", shortLabel: "N",
    sourceIssuer: "ondo", targetIssuer: "bstock", settlementSymbol: "USDT", destinationProtocol: "Venus",
    sourceSymbol: "NVDAon", targetSymbol: "NVDAB",
    sourceAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
    targetAddress: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
    venusMarketAddress: "0xeb8ca841cbe1bc4832a10b15c7dab1081edad371",
    routePreviewSupported: true, executionVerifierStatus: "VALIDATED",
  },
  SPCX: {
    underlying: "SPCX", displayName: "SPCX", shortLabel: "S",
    sourceIssuer: "ondo", targetIssuer: "bstock", settlementSymbol: "USDT", destinationProtocol: "Venus",
    sourceSymbol: "SPCXon", targetSymbol: "SPCXB",
    sourceAddress: "0xd0a58bc9d88d3ff48c0294cb7e45937d0e41a928",
    targetAddress: "0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1",
    venusMarketAddress: "0xc36dfacc7a125859c106f29b9f2d874ccf29a55a",
    routePreviewSupported: true, executionVerifierStatus: "NOT_VALIDATED",
  },
  TSLA: {
    underlying: "TSLA", displayName: "Tesla", shortLabel: "T",
    sourceIssuer: "ondo", targetIssuer: "bstock", settlementSymbol: "USDT", destinationProtocol: "Venus",
    sourceSymbol: "TSLAon", targetSymbol: "TSLAB",
    sourceAddress: "0x2494b603319d4d9f9715c9f4496d9e0364b59d93",
    targetAddress: "0x5b1910eaad6450e50f816082aa078c41f10c292f",
    venusMarketAddress: "0x97421799419eb782628e73e7220d8e0a207469a3",
    routePreviewSupported: true, executionVerifierStatus: "NOT_VALIDATED",
  },
};

export function isSupportedUnderlying(value: string): value is SupportedUnderlying {
  return Object.hasOwn(REGISTRY, value);
}

export function equityConfig(underlying: SupportedUnderlying): EquityConfig {
  return REGISTRY[underlying];
}

export function executionVerifierValidated(underlying: SupportedUnderlying): boolean {
  return equityConfig(underlying).executionVerifierStatus === "VALIDATED";
}

export function assertExecutionVerifierValidated(underlying: SupportedUnderlying): void {
  if (!executionVerifierValidated(underlying)) throw new Error("EXECUTION_VERIFIER_NOT_VALIDATED");
}
