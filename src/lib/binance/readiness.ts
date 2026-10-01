import "server-only";
import Decimal from "decimal.js";
import { decimalText, rawToDecimal, toRawUnits } from "@/domain/exposure/decimal";
import { firstViableCandidate, classifyCandidateError, fundingRequirement } from "@/domain/readiness/analysis";
import { evaluateRoute } from "@/domain/policy/evaluate";
import { USDT_ADDRESS } from "@/domain/routing/identity";
import type { Address, BrowserIntent, DestinationSnapshot, QuoteSnapshot, RepresentationSnapshot, RouteDecision } from "@/types/route";
import type { PreflightStage, PreflightAction } from "@/types/preflight";
import type { AcquisitionResult, CandidateResult, MainnetReadiness, ReadinessResult } from "@/types/readiness";
import { BinanceApiError } from "./client";
import { discoverRepresentations } from "./rwa";
import { discoverVenusInvestment } from "./defi";
import { getProofWalletBalances } from "./wallet";
import { requestQuote } from "./trading";
import { buildVenusDeposit } from "./defi-transaction";
import { buildSwapTransaction } from "./swap-build";
import { estimateProofGas } from "./gas";
import { derivePerLegSlippagePercent } from "@/domain/preflight/validate";

const POLICY_BPS = 50;
const USDT_DECIMALS = 18;
function intent(owner: Address, amount: string, source: RepresentationSnapshot): BrowserIntent {
  return { underlying: source.underlying, sourceRepresentation: "ondo", amount, destination: "venus", maxExposureLossBps: POLICY_BPS, takerAddress: owner };
}
function unavailableCandidate(amount: string, status: CandidateResult["status"], reason: string): CandidateResult {
  return { amount, status, viable: false, retentionPercent: null, venusBuild: null, reason, quotedUsdtOutput: null, quotedNvdabOutput: null };
}
function reasonOf(error: unknown): string {
  return error instanceof BinanceApiError ? `${error.businessCode}: ${error.message}` : error instanceof Error ? error.message : "Response unavailable";
}

async function candidate(owner: Address, amount: string, source: RepresentationSnapshot, target: RepresentationSnapshot, destination: DestinationSnapshot): Promise<{ result: CandidateResult; decision: RouteDecision | null; deposit?: PreflightStage }> {
  try {
    if (!destination.investable) return { result: unavailableCandidate(amount, "DESTINATION_UNAVAILABLE", `Venus ${target.symbol} is not investable`), decision: null };
    const sourceRaw = toRawUnits(amount, source.decimals);
    const leg1 = await requestQuote(1, source.address, USDT_ADDRESS, sourceRaw, owner);
    if (!leg1) return { result: unavailableCandidate(amount, "API_UNAVAILABLE", `No ${source.symbol} to USDT quote returned`), decision: null };
    const leg2 = await requestQuote(2, USDT_ADDRESS, target.address, leg1.outputRaw, owner);
    if (!leg2) return { result: unavailableCandidate(amount, "API_UNAVAILABLE", `No USDT to ${target.symbol} quote returned`), decision: null };
    const decision = evaluateRoute(intent(owner, amount, source), { source, target, sourceRaw, leg1, leg2, destination });
    const quotedUsdtOutput = decimalText(rawToDecimal(leg1.outputRaw, leg1.outputDecimals ?? USDT_DECIMALS));
    const quotedNvdabOutput = decimalText(rawToDecimal(leg2.outputRaw, target.decimals));
    if (decision.state !== "PASS") return { result: { amount, status: "POLICY_BLOCKED", viable: false, retentionPercent: decision.retentionPercent, venusBuild: null, reason: decision.reasons.join(", "), quotedUsdtOutput, quotedNvdabOutput }, decision };
    const deposit = await buildVenusDeposit(owner, destination, target, leg2.outputRaw);
    const authorizationSafe = deposit.authorizationStatus === "BOUNDED_READY" || deposit.authorizationStatus === "NOT_REQUIRED";
    const viable = deposit.buildStatus === "READY" && authorizationSafe;
    const status = !viable ? "DESTINATION_UNAVAILABLE" : deposit.simulationStatus === "BLOCKED_BY_WALLET_STATE" ? "WALLET_STATE_BLOCKED" : "AVAILABLE";
    return { result: { amount, status, viable, retentionPercent: decision.retentionPercent, venusBuild: deposit.buildStatus, reason: deposit.reason, quotedUsdtOutput, quotedNvdabOutput }, decision, deposit };
  } catch (error) {
    const reason = reasonOf(error);
    return { result: unavailableCandidate(amount, classifyCandidateError(error instanceof BinanceApiError ? error.businessCode : "", reason), reason), decision: null };
  }
}

async function sourceAcquisition(owner: Address, source: RepresentationSnapshot, selected: RouteDecision | null, currentNvdaon: string): Promise<{ result: AcquisitionResult; quote: QuoteSnapshot | null }> {
  if (!selected) return { result: { kind: "TEST_SETUP", required: false, status: "UNAVAILABLE", usdtInput: null, quotedNvdaonOutput: null, probes: [], note: "No viable product route was found to size test setup." }, quote: null };
  const deficit = new Decimal(selected.amount).minus(currentNvdaon);
  if (deficit.lte(0)) return { result: { kind: "TEST_SETUP", required: false, status: "NOT_REQUIRED", usdtInput: null, quotedNvdaonOutput: null, probes: [], note: "Source position is already present; setup acquisition is separate from EquityRelay." }, quote: null };
  const leg1Human = rawToDecimal(selected.evidence.leg1.outputRaw, selected.evidence.leg1.outputDecimals ?? USDT_DECIMALS);
  const probes: AcquisitionResult["probes"] = [];
  // Reverse-side quotes are indicative test setup. Probe bounded increases and stop at the first quote that covers the deficit.
  for (const multiplier of ["1", "1.0025", "1.005", "1.0075", "1.01", "1.02", "1.05", "1.1", "1.25", "1.5", "2"]) {
    const input = leg1Human.mul(new Decimal(multiplier)).toDecimalPlaces(USDT_DECIMALS, Decimal.ROUND_DOWN).toFixed();
    try {
      const quote = await requestQuote(2, USDT_ADDRESS, source.address, toRawUnits(input, USDT_DECIMALS), owner);
      if (!quote) { probes.push({ usdtInput: input, quotedNvdaonOutput: null, status: "UNAVAILABLE", reason: "No USDT to NVDAon quote returned" }); continue; }
      const output = decimalText(rawToDecimal(quote.outputRaw, source.decimals));
      probes.push({ usdtInput: input, quotedNvdaonOutput: output, status: "AVAILABLE", reason: null });
      if (new Decimal(output).gte(deficit)) return { result: { kind: "TEST_SETUP", required: true, status: "AVAILABLE", usdtInput: input, quotedNvdaonOutput: output, probes, note: "Indicative USDT to NVDAon test setup quote. This purchase is outside the EquityRelay route." }, quote };
    } catch (error) { probes.push({ usdtInput: input, quotedNvdaonOutput: null, status: classifyCandidateError(error instanceof BinanceApiError ? error.businessCode : "", reasonOf(error)) === "BELOW_MINIMUM" ? "BELOW_MINIMUM" : "UNAVAILABLE", reason: reasonOf(error) }); }
  }
  return { result: { kind: "TEST_SETUP", required: true, status: "UNAVAILABLE", usdtInput: null, quotedNvdaonOutput: null, probes, note: "No read-only test setup quote covered the source deficit." }, quote: null };
}

export async function buildMainnetReadiness(owner: Address): Promise<ReadinessResult> {
  try {
    // The proof-readiness surface intentionally remains the validated NVDA mainnet proof.
    const { source, target } = await discoverRepresentations("NVDA");
    const wallet = await getProofWalletBalances(owner, source, target);
    const destination = await discoverVenusInvestment("NVDA");
    if (!destination) return { kind: "unavailable", reason: "Venus NVDAB investment was not discovered", observedAt: new Date().toISOString() };
    const decisions = new Map<string, RouteDecision>();
    const deposits = new Map<string, PreflightStage>();
    const scan = await firstViableCandidate(async amount => {
      const probe = await candidate(owner, amount, source, target, destination);
      if (probe.decision) decisions.set(amount, probe.decision);
      if (probe.deposit) deposits.set(amount, probe.deposit);
      return probe.result;
    });
    const selected = scan.smallestViable ? decisions.get(scan.smallestViable.amount) ?? null : null;
    const acquisition = await sourceAcquisition(owner, source, selected, wallet.assets.NVDAon.balance);
    const proofActions: PreflightAction[] = [];
    if (selected) {
      const slip = derivePerLegSlippagePercent(selected);
      for (const quote of [selected.evidence.leg1, selected.evidence.leg2]) {
        try { proofActions.push(...(await buildSwapTransaction(quote, owner, slip)).actions); }
        catch { /* A build can become unavailable after a live quote; gas is explicitly incomplete. */ }
      }
      proofActions.push(...(deposits.get(selected.amount)?.actions ?? []));
    }
    let setupActions = null;
    if (acquisition.quote) {
      try { setupActions = (await buildSwapTransaction(acquisition.quote, owner, "0.5")).actions; }
      catch { /* The test setup gas estimate remains explicitly incomplete. */ }
    }
    const gas = await estimateProofGas(proofActions, setupActions, acquisition.result.required);
    const requirements: MainnetReadiness["requirements"] = [];
    if (scan.smallestViable) requirements.push(fundingRequirement(wallet, "NVDAon", scan.smallestViable.amount, "Smallest viable product route source"));
    if (acquisition.result.required && acquisition.result.usdtInput) requirements.push(fundingRequirement(wallet, "USDT", acquisition.result.usdtInput, "Indicative separate test setup acquisition"));
    if (gas.recommendedTotalGasReserveBNB || gas.provisionalTechnicalReserveBNB) requirements.push(fundingRequirement(wallet, "BNB", gas.recommendedTotalGasReserveBNB ?? gas.provisionalTechnicalReserveBNB!, gas.complete ? "Estimated gas plus 2× technical reserve" : "Provisional technical cushion; deposit gas unavailable"));
    const blockers: string[] = [];
    if (!selected) blockers.push("No candidate completed both quotes, exposure policy and Venus deposit build.");
    if (acquisition.result.required && acquisition.result.status !== "AVAILABLE") blockers.push("Source acquisition test setup quote unavailable.");
    if (!gas.complete) blockers.push("Gas estimate incomplete; do not infer an exact reserve.");
    for (const requirement of requirements) if (new Decimal(requirement.gap).gt(0)) blockers.push(`${requirement.asset} balance below read-only proof requirement.`);
    blockers.push("Future execution still requires separate user confirmations, settled amounts, fresh leg 2 quote and policy recheck.");
    return { kind: "readiness", wallet, candidates: scan.candidates, smallestViable: scan.smallestViable,
      acquisition: acquisition.result, gas, requirements, blockers, observedAt: new Date().toISOString(), state: "READ_ONLY_NOT_READY" };
  } catch (error) {
    return { kind: "unavailable", reason: reasonOf(error), observedAt: new Date().toISOString() };
  }
}
