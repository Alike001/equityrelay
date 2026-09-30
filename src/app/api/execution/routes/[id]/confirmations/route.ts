import { cookies } from "next/headers";
import { z } from "zod";
import { requireSameOrigin, sessionCookie, sessionWallet } from "@/lib/auth/siwe";
import { issueConfirmation, reserveConfirmation } from "@/lib/execution/repository";
import type { ExecutionActionV1 } from "@/domain/execution/action";

export const runtime = "nodejs";
const Stage = z.enum(["TEST_SETUP_APPROVAL", "TEST_SETUP_SWAP", "LEG1_APPROVAL", "LEG1_SWAP", "LEG2_APPROVAL", "LEG2_SWAP",
  "VENUS_APPROVAL", "VENUS_DEPOSIT", "VENUS_REDEEM", "EXIT_APPROVAL", "EXIT_SWAP"]);
const Input = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("ISSUE"), stage: Stage, idempotencyKey: z.string().uuid() }),
  z.strictObject({ operation: z.literal("RESERVE"), stage: Stage, token: z.string().min(32).max(256), actionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/), routeVersion: z.number().int().nonnegative() }),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    requireSameOrigin(request);
    const wallet = await sessionWallet((await cookies()).get(sessionCookie)?.value);
    if (!wallet) return Response.json({ code: "WALLET_AUTH_REQUIRED" }, { status: 401 });
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return Response.json({ code: "INVALID_ROUTE_ID" }, { status: 400 });
    const input = Input.parse(await request.json());
    if (input.operation === "ISSUE") {
      const issued = await issueConfirmation(id, wallet, input.stage as ExecutionActionV1["stage"], input.idempotencyKey);
      return Response.json({ confirmationToken: issued.token, actionHash: issued.step.actionHash, routeVersion: issued.routeVersion,
        stepId: issued.step.id, stage: issued.step.stage, executionArmed: false }, { headers: { "Cache-Control": "no-store" } });
    }
    await reserveConfirmation({ routeId: id, wallet, stage: input.stage as ExecutionActionV1["stage"], token: input.token,
      actionHash: input.actionHash, routeVersion: input.routeVersion });
    return Response.json({ state: "AWAITING_WALLET_TX", executionArmed: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "CONFIRMATION_UNAVAILABLE";
    return Response.json({ code }, { status: code === "EXECUTION_DATABASE_UNAVAILABLE" ? 503 : 409, headers: { "Cache-Control": "no-store" } });
  }
}
