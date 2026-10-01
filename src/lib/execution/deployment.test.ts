import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { productionReadinessConfig } from "./deployment";
const valid = { EQUITYRELAY_PUBLIC_ORIGIN: "https://equityrelay.example", DATABASE_URL: "postgresql://server/db?sslmode=require",
  EQUITYRELAY_BSC_RPC_URL: "https://rpc.example", BINANCE_W3_API_KEY: "key", BINANCE_W3_API_SECRET: "secret",
  BSC_MIN_CONFIRMATIONS: "3", BSC_REQUIRE_FINALIZED: "true", EQUITYRELAY_MAINNET_EXECUTION: "false" };
describe("production execution preparation configuration", () => {
  it("fails closed for every missing production authority", () => {
    for (const key of ["EQUITYRELAY_PUBLIC_ORIGIN", "DATABASE_URL", "EQUITYRELAY_BSC_RPC_URL", "BINANCE_W3_API_KEY", "BINANCE_W3_API_SECRET"] as const)
      expect(() => productionReadinessConfig({ ...valid, [key]: undefined })).toThrow();
    expect(() => productionReadinessConfig({ ...valid, EQUITYRELAY_PUBLIC_ORIGIN: "http://localhost:3000" })).toThrow("PRODUCTION_HTTPS_ORIGIN_REQUIRED");
  });
  it.each([["false",false],["true",true]] as const)("reports an infrastructure-ready deployment with execution arm %s", (value,armed) => {
    const result = productionReadinessConfig({ ...valid, EQUITYRELAY_MAINNET_EXECUTION: value });
    expect(result).toMatchObject({ origin: valid.EQUITYRELAY_PUBLIC_ORIGIN, databaseConfigured: true, rpcConfigured: true,
      binanceConfigured: true, minConfirmations: 3, requireFinalized: true, executionArmed: armed,
      walletSendCodeReleased: true, deprecatedRelayLocked: true });
    expect(JSON.stringify(result)).not.toContain("postgresql://");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
