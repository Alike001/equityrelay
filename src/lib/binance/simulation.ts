import "server-only";
import { signedRequest, BinanceApiError } from "./client";
import { isWalletStateFailure, parseSimulation, unavailableSimulation } from "@/domain/preflight/validate";
import type { SimulationResult } from "@/types/preflight";
import type { Address } from "@/types/route";

export async function simulateEvmTransaction(tx: { from: Address; to: Address; value: string; data: string }): Promise<SimulationResult> {
  try {
    // Connector b1fe19c describes exactly one chain-specific payload. Its generated SDK
    // incorrectly asserts evmTx, solTx and tronTx together; the signed API receives evmTx only.
    const result = await signedRequest("POST", "/api/v1/dex/pre-transaction/simulate", {
      body: { binanceChainId: "56", evmTx: tx },
    });
    return parseSimulation(result);
  } catch (error) {
    if (error instanceof BinanceApiError) {
      return { ...unavailableSimulation(`${error.businessCode}: ${error.message}`), status: isWalletStateFailure(error.message) ? "BLOCKED_BY_WALLET_STATE" : "UNAVAILABLE" };
    }
    return unavailableSimulation("Simulation response could not be validated.");
  }
}
