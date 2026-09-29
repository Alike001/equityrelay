import { z } from "zod";
import { requireSameOrigin, sessionCookie, verifyChallenge } from "@/lib/auth/siwe";
import { publicAuthError } from "@/lib/auth/public-error";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const body = z.strictObject({ message: z.string().max(2048), signature: z.string().regex(/^0x[a-fA-F0-9]+$/) }).parse(await request.json());
    const result = await verifyChallenge(body.message, body.signature as `0x${string}`);
    const response = Response.json({ wallet: result.wallet, chainId: 56 }, { headers: { "Cache-Control": "no-store" } });
    response.headers.append("Set-Cookie", `${sessionCookie}=${result.sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return response;
  } catch (error) {
    const code = publicAuthError(error);
    return Response.json({ code }, { status: code === "EXECUTION_DATABASE_UNAVAILABLE" ? 503 : 401, headers: { "Cache-Control": "no-store" } });
  }
}
