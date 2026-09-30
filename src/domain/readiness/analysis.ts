import Decimal from "decimal.js";
import { decimalText, rawToDecimal } from "@/domain/exposure/decimal";
import type { CandidateResult, CandidateStatus, GasEstimate, ProofAsset, WalletReadiness, FundingRequirement } from "@/types/readiness";

// Phase 2C established that 0.02 is below Binance's current USD minimum while
// 0.05 is viable. Probe the unresolved interval in ascending order and stop at
// the first complete route. Do not split orders to evade the venue minimum.
export const PROOF_CANDIDATES = ["0.021", "0.022", "0.023", "0.024", "0.025", "0.0275", "0.03"] as const;

export function classifyCandidateError(code: string, message: string): CandidateStatus {
  // An empty quote or generic API error is not evidence of a protocol minimum.
  return /(?:below.{0,20}minim|minim.{0,20}(?:amount|size|trade)|amount.{0,20}too small)/i.test(`${code} ${message}`)
    ? "BELOW_MINIMUM" : "API_UNAVAILABLE";
}

export async function firstViableCandidate(probe: (amount: string) => Promise<CandidateResult>): Promise<{ candidates: CandidateResult[]; smallestViable: CandidateResult | null }> {
  const candidates: CandidateResult[] = [];
  for (const amount of PROOF_CANDIDATES) {
    const result = await probe(amount);
    candidates.push(result);
    if (result.viable) return { candidates, smallestViable: result };
  }
  return { candidates, smallestViable: null };
}

export function gasCostBNB(units: string, priceWei: string): string {
  if (!/^(?:0|[1-9]\d*)$/.test(units) || !/^[1-9]\d*$/.test(priceWei)) throw new Error("INVALID_GAS_ESTIMATE");
  return decimalText(rawToDecimal((BigInt(units) * BigInt(priceWei)).toString(), 18));
}

export function calculateGasEstimate(proofUnits: string | null, setupUnits: string | null, priceWei: string | null, source: GasEstimate["priceSource"], missing: string[]): GasEstimate {
  const proofCost = proofUnits && priceWei ? gasCostBNB(proofUnits, priceWei) : null;
  const setupCost = setupUnits && priceWei ? gasCostBNB(setupUnits, priceWei) : null;
  const total = proofCost && setupCost ? decimalText(new Decimal(proofCost).plus(setupCost).mul(2)) : proofCost && setupUnits === "0" ? decimalText(new Decimal(proofCost).mul(2)) : null;
  return { priceWei, priceSource: source, proofGasUnits: proofUnits, setupGasUnits: setupUnits, knownProofGasUnits: proofUnits ?? "0", knownProofCostBNB: proofCost,
    estimatedProofCostBNB: proofCost, estimatedSetupCostBNB: setupCost,
    recommendedProofGasReserveBNB: proofCost ? decimalText(new Decimal(proofCost).mul(2)) : null,
    recommendedTotalGasReserveBNB: total, provisionalTechnicalReserveBNB: null, bufferMultiplier: "2", complete: missing.length === 0 && total !== null, missing };
}

export function fundingRequirement(wallet: WalletReadiness, asset: ProofAsset, requiredBalance: string, basis: string): FundingRequirement {
  const required = new Decimal(requiredBalance);
  const current = new Decimal(wallet.assets[asset].balance);
  return { asset, requiredBalance: decimalText(required), currentBalance: decimalText(current), gap: decimalText(Decimal.max(0, required.minus(current))), basis };
}
