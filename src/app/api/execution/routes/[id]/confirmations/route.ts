import { cookies } from "next/headers";
import { z } from "zod";
import { requireSameOrigin, sessionCookie, sessionWallet } from "@/lib/auth/siwe";
import { issueConfirmation } from "@/lib/execution/repository";
import type { ExecutionActionV1 } from "@/domain/execution/action";
import { invalidateCurrentStaleQuoteReview } from "@/lib/execution/refresh";
import type { Address } from "@/types/route";

export const runtime = "nodejs";
const Stage = z.enum(["TEST_SETUP_APPROVAL", "TEST_SETUP_SWAP", "LEG1_APPROVAL", "LEG1_SWAP", "LEG2_APPROVAL", "LEG2_SWAP",
  "VENUS_APPROVAL", "VENUS_DEPOSIT", "VENUS_REDEEM", "EXIT_APPROVAL", "EXIT_SWAP"]);
const Input = z.strictObject({ operation: z.literal("ISSUE"), stage: Stage, idempotencyKey: z.string().uuid() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let wallet: string | null = null;
  let id: string | null = null;
  let input: z.infer<typeof Input> | null = null;
  try {
    requireSameOrigin(request);
    wallet = await sessionWallet((await cookies()).get(sessionCookie)?.value);
    if (!wallet) return Response.json({ code: "WALLET_AUTH_REQUIRED" }, { status: 401 });
    id = (await context.params).id;
    if (!z.uuid().safeParse(id).success) return Response.json({ code: "INVALID_ROUTE_ID" }, { status: 400 });
    input = Input.parse(await request.json());
    const issued = await issueConfirmation(id, wallet, input.stage as ExecutionActionV1["stage"], input.idempotencyKey);
    return Response.json({ confirmationToken: issued.token, actionHash: issued.step.actionHash, routeVersion: issued.routeVersion,
      stepId: issued.step.id, stage: issued.step.stage, executionArmed: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "CONFIRMATION_UNAVAILABLE";
    if ((code === "QUOTE_REVIEW_EXPIRED" || code === "QUOTE_REFRESH_REQUIRED") && wallet && id && input) {
      try { await invalidateCurrentStaleQuoteReview(id,wallet as Address,input.stage as ExecutionActionV1["stage"]); }
      catch { /* Return the deterministic refresh refusal even if cleanup races another request. */ }
      return Response.json({ code: "QUOTE_REFRESH_REQUIRED", state: "QUOTE_REFRESH_REQUIRED" },
        { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ code }, { status: code === "EXECUTION_DATABASE_UNAVAILABLE" ? 503 : 409, headers: { "Cache-Control": "no-store" } });
  }
}
