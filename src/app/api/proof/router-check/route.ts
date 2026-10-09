import { requireSameOrigin } from "@/lib/auth/siwe";
import { cachedRouterRuntimeCheck } from "@/lib/proof/router-check";
import { consumePublicProofRate } from "@/lib/proof/public-rate-limit";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    await consumePublicProofRate(request);
    return Response.json(await cachedRouterRuntimeCheck(), {
      headers: { "Cache-Control": "private, max-age=0, no-store" },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ROUTER_CHECK_UNAVAILABLE";
    const status = code === "AUTH_RATE_LIMITED" ? 429 : code.includes("CONFIGURATION") || code.includes("DATABASE") ? 503 : 400;
    return Response.json({ code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
