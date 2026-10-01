export type GasEvidenceClass = "LIVE_CURRENT" | "HISTORICAL_CANONICAL" | "PROXY" | "UNAVAILABLE";
export type ClassifiedGasEvidence = { action: string; gasUnits: string | null; classification: GasEvidenceClass; observedAt: string; source: string };

export function summarizeGasEvidence(items: readonly ClassifiedGasEvidence[], priceWei: string, bufferBps = 20000): {
  knownGasUnits: string; estimatedCostBNB: string; recommendedReserveBNB: string; complete: boolean } {
  if (!/^[1-9]\d*$/.test(priceWei) || !Number.isInteger(bufferBps) || bufferBps < 10000 || bufferBps > 30000)
    throw new Error("INVALID_GAS_EVIDENCE_POLICY");
  let units = 0n;
  for (const item of items) {
    if (item.gasUnits !== null && !/^[1-9]\d*$/.test(item.gasUnits)) throw new Error("INVALID_GAS_UNITS");
    if (item.gasUnits) units += BigInt(item.gasUnits);
  }
  const costWei = units * BigInt(priceWei);
  const reserveWei = costWei * BigInt(bufferBps) / 10000n;
  const decimal = (value: bigint) => `${value / 10n ** 18n}.${(value % 10n ** 18n).toString().padStart(18,"0")}`.replace(/\.?0+$/,"");
  return { knownGasUnits: units.toString(), estimatedCostBNB: decimal(costWei), recommendedReserveBNB: decimal(reserveWei),
    complete: items.length > 0 && items.every(item => item.classification !== "UNAVAILABLE" && item.classification !== "PROXY") };
}
