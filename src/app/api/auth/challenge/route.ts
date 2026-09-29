import { z } from "zod";
import { createChallenge, requireSameOrigin } from "@/lib/auth/siwe";
import { publicAuthError } from "@/lib/auth/public-error";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const body = z.strictObject({ wallet: z.string() }).parse(await request.json());
    const challenge = await createChallenge(body.wallet);
    return Response.json(challenge, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = publicAuthError(error);
    return Response.json({ code }, { status: code === "EXECUTION_DATABASE_UNAVAILABLE" ? 503 : 400, headers: { "Cache-Control": "no-store" } });
  }
}
