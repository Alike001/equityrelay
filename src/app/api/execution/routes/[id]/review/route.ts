import { cookies } from "next/headers";
import { z } from "zod";
import { requireSameOrigin, sessionCookie, sessionWallet } from "@/lib/auth/siwe";
import { prepareInitialExecutionReview } from "@/lib/execution/initial-review";
import type { Address } from "@/types/route";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    requireSameOrigin(request);
    z.strictObject({}).parse(await request.json());
    const wallet = await sessionWallet((await cookies()).get(sessionCookie)?.value);
    if (!wallet) return Response.json({ code: "WALLET_AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return Response.json({ code: "INVALID_ROUTE_ID" }, { status: 400 });
    return Response.json(await prepareInitialExecutionReview(id, wallet as Address), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = new Set(["ROUTE_NOT_REVIEWABLE", "FRESH_ROUTE_POLICY_PASS_REQUIRED", "FRESH_QUOTE_REQUIRED",
      "RFQ_EXECUTION_REVIEW_UNAVAILABLE", "SWAP_ACTION_UNAVAILABLE", "ROUTE_VERSION_CONFLICT", "BOUNDED_APPROVAL_REQUIRED",
      "EXECUTION_DATABASE_UNAVAILABLE", "BSC_RPC_UNAVAILABLE"]);
    const code = error instanceof Error && known.has(error.message) ? error.message : "EXECUTION_REVIEW_UNAVAILABLE";
    return Response.json({ code }, { status: code === "EXECUTION_DATABASE_UNAVAILABLE" ? 503 : 409, headers: { "Cache-Control": "no-store" } });
  }
}
