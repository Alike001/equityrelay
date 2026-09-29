import { z } from "zod";
import { requireBroadcastRelease, requireMainnetExecutionArm } from "@/domain/execution/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Confirmation = z.strictObject({ executionIntentId: z.string().uuid(), confirmationToken: z.string().min(32).max(256), boundary: z.enum(["LEAVE_ONDO", "CHANGE_REPRESENTATION", "SUPPLY_TO_VENUS"]) });

export async function POST(request: Request): Promise<Response> {
  try { requireMainnetExecutionArm(); }
  catch { return Response.json({ code: "MAINNET_EXECUTION_NOT_ARMED" }, { status: 423, headers: { "Cache-Control": "no-store" } }); }
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  if (!Confirmation.safeParse(body).success) return Response.json({ code: "INVALID_CONFIRMATION_REFERENCE" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  // Phase 3A has no durable intent store or authenticated wallet session. The
  // endpoint stays closed even if the environment flag is accidentally enabled.
  try { requireBroadcastRelease(); }
  catch { return Response.json({ code: "PHASE3A_BROADCAST_DISABLED" }, { status: 423, headers: { "Cache-Control": "no-store" } }); }
}
