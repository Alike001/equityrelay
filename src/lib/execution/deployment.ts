import "server-only";
import { mainnetExecutionArmed } from "@/domain/execution/guard";

export type ProductionReadinessConfig = { origin: string; databaseConfigured: true; rpcConfigured: true; binanceConfigured: true;
  minConfirmations: number; requireFinalized: boolean; executionArmed: boolean;
  walletSendCodeReleased: true; deprecatedRelayLocked: true };

export function productionReadinessConfig(environment: Record<string, string | undefined> = process.env): ProductionReadinessConfig {
  const origin = environment.EQUITYRELAY_PUBLIC_ORIGIN;
  if (!origin || !/^https:\/\/[^/]+(?:\/)?$/.test(origin)) throw new Error("PRODUCTION_HTTPS_ORIGIN_REQUIRED");
  if (!environment.DATABASE_URL || !/^postgres(?:ql)?:\/\//.test(environment.DATABASE_URL)) throw new Error("MANAGED_POSTGRES_REQUIRED");
  if (!environment.EQUITYRELAY_BSC_RPC_URL || !/^https:\/\//.test(environment.EQUITYRELAY_BSC_RPC_URL)) throw new Error("PRODUCTION_BSC_RPC_REQUIRED");
  if (!environment.BINANCE_W3_API_KEY || !environment.BINANCE_W3_API_SECRET) throw new Error("BINANCE_SERVER_CREDENTIALS_REQUIRED");
  const confirmations = Number(environment.BSC_MIN_CONFIRMATIONS ?? "3");
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 100) throw new Error("INVALID_FINALITY_POLICY");
  return { origin: origin.replace(/\/$/, ""), databaseConfigured: true, rpcConfigured: true, binanceConfigured: true,
    minConfirmations: confirmations, requireFinalized: environment.BSC_REQUIRE_FINALIZED === "true",
    executionArmed: mainnetExecutionArmed(environment), walletSendCodeReleased: true, deprecatedRelayLocked: true };
}
