import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/execution/deployment", () => ({ productionReadinessConfig: vi.fn(() => ({
  origin: "https://equityrelay.example", minConfirmations: 3, requireFinalized: true,
  executionArmed: false, walletSendCodeReleased: true, deprecatedRelayLocked: true,
})) }));
vi.mock("@/lib/db/pool", () => ({ executionPool: vi.fn(() => ({ query: vi.fn().mockResolvedValue({ rows: [{ count: 4 }] }) })) }));
vi.mock("@/lib/execution/rpc", () => ({ canonicalRpcReadiness: vi.fn() }));

import { canonicalRpcReadiness } from "@/lib/execution/rpc";
import { productionReadinessConfig } from "@/lib/execution/deployment";
import { GET } from "./route";

describe("production execution readiness route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses READY when canonical verification is unavailable", async () => {
    vi.mocked(canonicalRpcReadiness).mockResolvedValue({ status: "UNAVAILABLE", reason: "RPC_HTTP_FORBIDDEN" });
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "BLOCKED", code: "RPC_VERIFICATION_UNAVAILABLE", reason: "RPC_HTTP_FORBIDDEN" });
  });

  it("reports the configured confirmation and finalized policy with canonical evidence", async () => {
    vi.mocked(canonicalRpcReadiness).mockResolvedValue({ status: "READY", chainId: 56, finalizedBlock: "124900000",
      probeBlock: "124836339", boundedLogCount: 1 });
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "READY_READ_ONLY", chainId: 56,
      minConfirmations: 3, requireFinalized: true, rpcProbeBlock: "124836339", boundedLogCount: 1,
      executionArmed: false, walletSendCodeReleased: true, deprecatedRelayLocked: true });
  });

  it("reports healthy armed infrastructure without changing the deprecated relay fact", async () => {
    vi.mocked(productionReadinessConfig).mockReturnValueOnce({ origin: "https://equityrelay.example", databaseConfigured: true,
      rpcConfigured: true, binanceConfigured: true, minConfirmations: 3, requireFinalized: true, executionArmed: true,
      walletSendCodeReleased: true, deprecatedRelayLocked: true });
    vi.mocked(canonicalRpcReadiness).mockResolvedValue({ status: "READY", chainId: 56, finalizedBlock: "124900000",
      probeBlock: "124836339", boundedLogCount: 1 });
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "READY_ARMED", executionArmed: true,
      walletSendCodeReleased: true, deprecatedRelayLocked: true });
  });
});
