import { cookies } from "next/headers";
import { z } from "zod";
import { requireSameOrigin, sessionCookie, sessionWallet } from "@/lib/auth/siwe";
import { acceptReportedHash, reconcileStoredStep } from "@/lib/execution/reconcile";
import type { Address } from "@/types/route";

export const runtime = "nodejs";
const Input = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("REPORT"), txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/) }),
  z.strictObject({ operation: z.literal("RECONCILE") }),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string; stepId: string }> }): Promise<Response> {
  try {
    requireSameOrigin(request);
    const wallet = await sessionWallet((await cookies()).get(sessionCookie)?.value);
    if (!wallet) return Response.json({ code: "WALLET_AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const { id, stepId } = await context.params;
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(stepId).success)
      return Response.json({ code: "INVALID_TRANSACTION_REFERENCE" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const input = Input.parse(await request.json());
    if (input.operation === "REPORT") await acceptReportedHash(id,wallet as Address,stepId,input.txHash as `0x${string}`);
    const status = await reconcileStoredStep(id,wallet as Address,stepId);
    const state = status === "PENDING" ? "WAITING_FOR_CANONICAL_CONFIRMATION" : status;
    return Response.json({ state, txHashAcceptedAsLookupHint: input.operation === "REPORT" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "CANONICAL_RECONCILIATION_UNAVAILABLE";
    const status = code === "EXECUTION_DATABASE_UNAVAILABLE" || code === "BSC_RPC_UNAVAILABLE" ? 503 : 409;
    return Response.json({ code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
