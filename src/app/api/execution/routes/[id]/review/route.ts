import { cookies } from "next/headers";
import { z } from "zod";
import { requireSameOrigin, sessionCookie, sessionWallet } from "@/lib/auth/siwe";
import { prepareInitialExecutionReview } from "@/lib/execution/initial-review";
import { prepareDurableLeg2Review, prepareDurableVenusReview } from "@/lib/execution/post-settlement";
import { prepareDurableExitReview, prepareDurableRedeemReview } from "@/lib/execution/recovery-review";
import { prepareDependentAction } from "@/lib/execution/next-action";
import { getExecutionRoute } from "@/lib/execution/repository";
import { prepareDurableTestSetupReview } from "@/lib/execution/test-setup-review";
import type { Address } from "@/types/route";
import { refreshCurrentTestSetupReview } from "@/lib/execution/refresh";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    requireSameOrigin(request);
    const input = z.union([z.strictObject({}), z.strictObject({ phase: z.literal("TEST_SETUP") }),
      z.strictObject({ phase: z.literal("TEST_SETUP"), operation: z.literal("REFRESH") })]).parse(await request.json());
    const wallet = await sessionWallet((await cookies()).get(sessionCookie)?.value);
    if (!wallet) return Response.json({ code: "WALLET_AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return Response.json({ code: "INVALID_ROUTE_ID" }, { status: 400 });
    const stored = await getExecutionRoute(id, wallet);
    if (!stored) throw new Error("ROUTE_NOT_FOUND");
    const prepared = "operation" in input ? await refreshCurrentTestSetupReview(id,wallet as Address)
      : "phase" in input ? await prepareDurableTestSetupReview(id, wallet as Address)
      : stored.session.testSetup?.state === "SETUP_REVIEW_READY" && stored.session.submitted.TEST_SETUP_APPROVAL?.status === "CONFIRMED" ||
        ["LEG1_APPROVAL_CONFIRMED", "LEG2_APPROVAL_CONFIRMED", "VENUS_APPROVAL_CONFIRMED"].includes(stored.state) ||
      stored.session.recovery?.state === "EXIT_REVIEW_READY" && stored.session.submitted.EXIT_APPROVAL?.status === "CONFIRMED"
      ? await prepareDependentAction(id, wallet as Address)
      : stored.session.recovery?.state === "VENUS_POSITION_VERIFIED" ? await prepareDurableRedeemReview(id, wallet as Address)
      : stored.session.recovery?.state === "ACTUAL_NVDAB_REDEEMED" ? await prepareDurableExitReview(id, wallet as Address)
      : stored.state === "ACTUAL_USDT_MEASURED" ? await prepareDurableLeg2Review(id, wallet as Address)
      : stored.state === "ACTUAL_NVDAB_MEASURED" ? await prepareDurableVenusReview(id, wallet as Address)
      : await prepareInitialExecutionReview(id, wallet as Address);
    return Response.json(prepared, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = new Set(["ROUTE_NOT_REVIEWABLE", "FRESH_ROUTE_POLICY_PASS_REQUIRED", "FRESH_QUOTE_REQUIRED",
      "RFQ_EXECUTION_REVIEW_UNAVAILABLE", "SWAP_ACTION_UNAVAILABLE", "ROUTE_VERSION_CONFLICT", "BOUNDED_APPROVAL_REQUIRED",
      "EXECUTION_DATABASE_UNAVAILABLE", "BSC_RPC_UNAVAILABLE", "ROUTE_NOT_FOUND", "VERIFIED_VENUS_POSITION_REQUIRED",
      "VENUS_REDEEM_BUILD_UNAVAILABLE", "ACTUAL_REDEEMED_NVDAB_REQUIRED", "FRESH_EXIT_QUOTE_REQUIRED", "EXIT_BUILD_UNAVAILABLE",
      "DEPENDENT_ACTION_NOT_READY", "TEST_SETUP_NOT_REVIEWABLE", "TEST_SETUP_QUOTE_UNAVAILABLE", "TEST_SETUP_BUILD_UNAVAILABLE",
      "TEST_SETUP_REFRESH_REQUIRES_MANUAL_REVIEW", "TEST_SETUP_REVIEW_STILL_FRESH"]);
    const code = error instanceof Error && known.has(error.message) ? error.message : "EXECUTION_REVIEW_UNAVAILABLE";
    return Response.json(code === "TEST_SETUP_REFRESH_REQUIRES_MANUAL_REVIEW" ? { code,state:"MANUAL_REVIEW_REQUIRED" } : { code },
      { status: code === "EXECUTION_DATABASE_UNAVAILABLE" ? 503 : 409, headers: { "Cache-Control": "no-store" } });
  }
}
