import "server-only";
import { ZodError } from "zod";
import { toRawUnits } from "@/domain/exposure/decimal";
import { evaluateRoute } from "@/domain/policy/evaluate";
import { USDT_ADDRESS } from "@/domain/routing/identity";
import type { BrowserIntent, PreviewResult } from "@/types/route";
import { BinanceApiError } from "./client";
import { discoverRepresentations } from "./rwa";
import { requestQuote } from "./trading";
import { discoverVenusInvestment } from "./defi";
import { equityConfig } from "@/domain/equities/registry";

export async function buildPreview(intent: BrowserIntent): Promise<PreviewResult> {
  const config = equityConfig(intent.underlying);
  const capability = { underlying: config.underlying, displayName: config.displayName,
    executionVerifierStatus: config.executionVerifierStatus };
  try {
    const { source, target } = await discoverRepresentations(intent.underlying);
    const sourceRaw = toRawUnits(intent.amount, source.decimals);
    const rawLeg1 = await requestQuote(1, source.address, USDT_ADDRESS, sourceRaw, intent.takerAddress);
    const leg1 = rawLeg1 ? { ...rawLeg1, inputSymbol: source.symbol, outputSymbol: "USDT" } : null;
    if (!leg1) return { kind: "blocked", state: "BLOCKED", ...capability, reasons: ["BLOCK_NO_LEG1_QUOTE"], message: "No route is available from the current representation to USDT." };
    const rawLeg2 = await requestQuote(2, USDT_ADDRESS, target.address, leg1.outputRaw, intent.takerAddress);
    const leg2 = rawLeg2 ? { ...rawLeg2, inputSymbol: "USDT", outputSymbol: target.symbol } : null;
    if (!leg2) return { kind: "blocked", state: "BLOCKED", ...capability, reasons: ["BLOCK_NO_LEG2_QUOTE"], message: "No route is available from USDT to the Venus-compatible representation." };
    const destination = await discoverVenusInvestment(intent.underlying);
    if (!destination) return { kind: "blocked", state: "BLOCKED", ...capability, reasons: ["BLOCK_DESTINATION_NOT_INVESTABLE"], message: `Venus does not currently list the compatible ${config.displayName} representation.` };
    return evaluateRoute(intent, { source, target, sourceRaw, leg1, leg2, destination });
  } catch (error) {
    if (error instanceof BinanceApiError) {
      // Business errors may arrive with HTTP 200. Report availability failure, never a simulated result.
      console.error("Binance read-only API failure", { path: error.path, status: error.status, code: error.businessCode, message: error.message });
      return { kind: "unavailable", state: "UNAVAILABLE", ...capability, reasons: ["UNAVAILABLE_API"], message: `Binance route data is unavailable (${error.businessCode}). Please try again.` };
    }
    if (error instanceof ZodError || error instanceof Error) {
      console.error("Invalid route evidence", { reason: error.message });
      return { kind: "unavailable", state: "UNAVAILABLE", ...capability, reasons: ["INVALID_EVIDENCE"], message: "Live route evidence was incomplete or inconsistent. No result was assumed." };
    }
    return { kind: "unavailable", state: "UNAVAILABLE", ...capability, reasons: ["INVALID_EVIDENCE"], message: "Live route evidence could not be validated." };
  }
}
