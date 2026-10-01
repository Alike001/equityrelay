import { cookies } from "next/headers";
import { z } from "zod";
import { requireSameOrigin, sessionCookie, sessionWallet } from "@/lib/auth/siwe";
import type { ExecutionActionV1 } from "@/domain/execution/action";
import { deliverWalletAction } from "@/lib/execution/handoff";
import { invalidateStaleQuoteReview, regenerateStaleQuoteReview } from "@/lib/execution/refresh";
import type { Address } from "@/types/route";

export const runtime = "nodejs";
const Stage = z.enum(["TEST_SETUP_APPROVAL","TEST_SETUP_SWAP","LEG1_APPROVAL","LEG1_SWAP","LEG2_APPROVAL","LEG2_SWAP",
  "VENUS_APPROVAL","VENUS_DEPOSIT","VENUS_REDEEM","EXIT_APPROVAL","EXIT_SWAP"]);
const Input = z.strictObject({ stage: Stage, confirmationToken: z.string().min(32).max(256),
  actionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/), routeVersion: z.number().int().nonnegative() });

export async function POST(request: Request, context: { params: Promise<{ id: string; stepId: string }> }): Promise<Response> {
  let parsed: z.infer<typeof Input> | null = null;
  let wallet: string | null = null;
  let ids: { id: string; stepId: string } | null = null;
  try {
    requireSameOrigin(request);
    wallet = await sessionWallet((await cookies()).get(sessionCookie)?.value);
    if (!wallet) return Response.json({ code: "WALLET_AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    ids = await context.params;
    if (!z.uuid().safeParse(ids.id).success || !z.uuid().safeParse(ids.stepId).success)
      return Response.json({ code: "INVALID_ACTION_REFERENCE" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    parsed = Input.parse(await request.json());
    const delivered = await deliverWalletAction({ routeId: ids.id, stepId: ids.stepId, wallet, stage: parsed.stage as ExecutionActionV1["stage"],
      token: parsed.confirmationToken, actionHash: parsed.actionHash, routeVersion: parsed.routeVersion });
    return Response.json({ ...delivered, state: "READY_FOR_WALLET_REVIEW", executionArmed: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ACTION_DELIVERY_UNAVAILABLE";
    if (code === "QUOTE_REFRESH_REQUIRED" && wallet && ids && parsed) {
      try {
        const stage = await invalidateStaleQuoteReview(ids.id,wallet as Address,ids.stepId,parsed.actionHash);
        const refreshed = await regenerateStaleQuoteReview(ids.id,wallet as Address,stage);
        return Response.json({ code, state: "QUOTE_REFRESH_REQUIRED", refreshed }, { status: 409, headers: { "Cache-Control": "no-store" } });
      } catch { /* Return the deterministic refusal below. */ }
    }
    const status = code === "EXECUTION_DATABASE_UNAVAILABLE" || code === "BSC_RPC_UNAVAILABLE" ? 503 : 409;
    return Response.json({ code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
