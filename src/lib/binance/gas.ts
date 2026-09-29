import "server-only";
import { z } from "zod";
import { signedRequest } from "./client";
import type { PreflightAction } from "@/types/preflight";
import type { GasEstimate } from "@/types/readiness";
import { calculateGasEstimate } from "@/domain/readiness/analysis";
import Decimal from "decimal.js";
import { decimalText, rawToDecimal } from "@/domain/exposure/decimal";

const PositiveInteger = z.string().regex(/^[1-9]\d*$/);
const GasPrice = z.object({ evmLegacyGasPrice: z.object({ mediumGasPrice: z.string().optional() }).nullable().optional(), eip1559GasPrice: z.object({ mediumMaxFee: z.string().optional() }).nullable().optional() });
const GasLimit = z.object({ gasLimit: PositiveInteger });

export async function currentBscGasPrice(): Promise<{ priceWei: string; source: GasEstimate["priceSource"] }> {
  const data = GasPrice.parse(await signedRequest("GET", "/api/v1/dex/pre-transaction/gas-price", { params: { binanceChainId: "56" } }));
  const legacy = data.evmLegacyGasPrice?.mediumGasPrice;
  const eip = data.eip1559GasPrice?.mediumMaxFee;
  if (eip && PositiveInteger.safeParse(eip).success) return { priceWei: eip, source: "EIP1559_MEDIUM_MAX_FEE" };
  if (legacy && PositiveInteger.safeParse(legacy).success) return { priceWei: legacy, source: "LEGACY_MEDIUM" };
  throw new Error("GAS_PRICE_UNAVAILABLE");
}

export async function estimateActionGas(action: PreflightAction): Promise<string> {
  if (action.kind === "RFQ") throw new Error("RFQ_GAS_UNAVAILABLE");
  if (action.gasLimit && PositiveInteger.safeParse(action.gasLimit).success) return action.gasLimit;
  if (!action.to || !action.rawCalldata || action.valueWei === null) throw new Error("ACTION_GAS_UNAVAILABLE");
  const data = GasLimit.parse(await signedRequest("POST", "/api/v1/dex/pre-transaction/gas-limit", {
    body: { binanceChainId: "56", evmTx: { from: action.from, to: action.to, value: action.valueWei, data: action.rawCalldata } },
  }));
  return data.gasLimit;
}

export async function estimateProofGas(actions: PreflightAction[], setupActions: PreflightAction[] | null, setupRequired: boolean): Promise<GasEstimate> {
  const missing: string[] = [];
  if (actions.filter(action => action.kind === "SWAP").length !== 2) missing.push("Two swap builds unavailable for gas estimate");
  if (actions.filter(action => action.kind === "DEPOSIT").length !== 1) missing.push("Venus deposit build unavailable for gas estimate");
  let priceWei: string | null = null;
  let source: GasEstimate["priceSource"] = null;
  try { const gas = await currentBscGasPrice(); priceWei = gas.priceWei; source = gas.source; }
  catch (error) { missing.push(`Gas price: ${error instanceof Error ? error.message : "unavailable"}`); }
  let knownProofUnits = 0n;
  let knownProofCostWei = 0n;
  let knownSetupCostWei = 0n;
  async function sum(items: PreflightAction[], label: string): Promise<string | null> {
    let total = 0n;
    for (const [index, item] of items.entries()) {
      try {
        const units = BigInt(await estimateActionGas(item));
        total += units;
        const builtPrice = item.maxFeePerGas ?? item.gasPrice;
        const actionPrice = builtPrice && PositiveInteger.safeParse(builtPrice).success ? BigInt(builtPrice) : 0n;
        if (priceWei) {
          const effectivePrice = actionPrice > BigInt(priceWei) ? actionPrice : BigInt(priceWei);
          if (label === "Proof") knownProofCostWei += units * effectivePrice;
          else knownSetupCostWei += units * effectivePrice;
        }
        if (label === "Proof") knownProofUnits += units;
      }
      catch { missing.push(`${label} action ${index + 1}: gas limit unavailable from current wallet state`); }
    }
    return missing.some(x => x.startsWith(`${label} action`)) ? null : total.toString();
  }
  const proofUnits = actions.length ? await sum(actions, "Proof") : null;
  if (!actions.length) missing.push("Proof actions unavailable");
  const setupUnits = !setupRequired ? "0" : setupActions?.length ? await sum(setupActions, "Setup") : null;
  if (setupRequired && !setupActions?.length) missing.push("Setup actions unavailable");
  const base = calculateGasEstimate(proofUnits, setupUnits, priceWei, source, missing);
  const proofCost = priceWei && proofUnits ? decimalText(rawToDecimal(knownProofCostWei.toString(), 18)) : null;
  const setupCost = priceWei && setupUnits ? decimalText(rawToDecimal(knownSetupCostWei.toString(), 18)) : setupUnits === "0" ? "0" : null;
  const total = proofCost !== null && setupCost !== null ? decimalText(new Decimal(proofCost).plus(setupCost).mul(2)) : null;
  // When one gas limit is unavailable, this is a labeled planning cushion, not an estimated total fee.
  const knownCombined = decimalText(rawToDecimal((knownProofCostWei + knownSetupCostWei).toString(), 18));
  const provisional = priceWei && !total ? decimalText(Decimal.max("0.002", new Decimal(knownCombined).mul(10))) : null;
  return { ...base, knownProofGasUnits: knownProofUnits.toString(), knownProofCostBNB: priceWei ? decimalText(rawToDecimal(knownProofCostWei.toString(), 18)) : null,
    estimatedProofCostBNB: proofCost, estimatedSetupCostBNB: setupCost,
    recommendedProofGasReserveBNB: proofCost !== null ? decimalText(new Decimal(proofCost).mul(2)) : null,
    recommendedTotalGasReserveBNB: total, provisionalTechnicalReserveBNB: provisional,
    complete: missing.length === 0 && total !== null };
}
