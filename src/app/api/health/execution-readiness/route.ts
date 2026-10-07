import { productionReadinessConfig } from "@/lib/execution/deployment";
import { executionPool } from "@/lib/db/pool";
import { canonicalRpcReadiness } from "@/lib/execution/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  try {
    const config = productionReadinessConfig();
    const [database, rpc] = await Promise.all([
      executionPool().query("SELECT count(*)::integer AS count FROM schema_migrations"),
      canonicalRpcReadiness(undefined, config.requireFinalized),
    ]);
    if (Number(database.rows[0]?.count) < 4) throw new Error("DEPLOYMENT_DEPENDENCY_NOT_READY");
    if (rpc.status !== "READY") return Response.json({ status: "BLOCKED", canonicalRpcStatus: "UNAVAILABLE",
      activeProviderRole: null, fallbackQualified: false, code: "RPC_VERIFICATION_UNAVAILABLE", reason: rpc.reason },
      { status: 503, headers: { "Cache-Control": "no-store" } });
    return Response.json({ status: config.executionArmed ? "READY_ARMED" : "READY_READ_ONLY", canonicalRpcStatus: "READY",
      activeProviderRole: "PRIMARY", fallbackQualified: false, origin: config.origin,
      databaseMigrations: Number(database.rows[0].count), chainId: rpc.chainId,
      minConfirmations: config.minConfirmations, requireFinalized: config.requireFinalized, finalizedBlock: rpc.finalizedBlock,
      rpcProbeBlock: rpc.probeBlock, boundedLogCount: rpc.boundedLogCount, executionArmed: config.executionArmed,
      walletSendCodeReleased: config.walletSendCodeReleased, deprecatedRelayLocked: config.deprecatedRelayLocked },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ status: "BLOCKED", code: error instanceof Error ? error.message : "DEPLOYMENT_READINESS_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
