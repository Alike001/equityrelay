import { productionReadinessConfig } from "@/lib/execution/deployment";
import { executionPool } from "@/lib/db/pool";
import { bscPublicClient, readBscWithRetry } from "@/lib/execution/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  try {
    const config = productionReadinessConfig();
    const [database, chainId, finalized] = await Promise.all([
      executionPool().query("SELECT count(*)::integer AS count FROM schema_migrations"),
      readBscWithRetry(() => bscPublicClient().getChainId()),
      config.requireFinalized ? readBscWithRetry(() => bscPublicClient().getBlock({ blockTag: "finalized" })).then(block => block.number.toString()) : Promise.resolve(null),
    ]);
    if (chainId !== 56 || Number(database.rows[0]?.count) < 4) throw new Error("DEPLOYMENT_DEPENDENCY_NOT_READY");
    return Response.json({ status: "READY_READ_ONLY", origin: config.origin, databaseMigrations: Number(database.rows[0].count), chainId,
      minConfirmations: config.minConfirmations, finalizedBlock: finalized, executionArmed: false, broadcastCodeLock: true },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ status: "BLOCKED", code: error instanceof Error ? error.message : "DEPLOYMENT_READINESS_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
