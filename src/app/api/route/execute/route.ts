import { requireBroadcastRelease, requireMainnetExecutionArm } from "@/domain/execution/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(): Promise<Response> {
  try { requireMainnetExecutionArm(); }
  catch { return Response.json({ code: "MAINNET_EXECUTION_NOT_ARMED" }, { status: 423, headers: { "Cache-Control": "no-store" } }); }
  // Deprecated Phase 3A relay placeholder. It is intentionally not connected
  // to the authenticated durable action APIs, ignores request data, and
  // remains permanently closed.
  try { requireBroadcastRelease(); }
  catch { return Response.json({ code: "PHASE3A_BROADCAST_DISABLED" }, { status: 423, headers: { "Cache-Control": "no-store" } }); }
}
