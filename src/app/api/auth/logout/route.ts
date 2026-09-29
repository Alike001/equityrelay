import { cookies } from "next/headers";
import { requireSameOrigin, revokeSession, sessionCookie } from "@/lib/auth/siwe";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const cookieStore = await cookies();
    await revokeSession(cookieStore.get(sessionCookie)?.value);
    cookieStore.delete(sessionCookie);
    return Response.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ code: "LOGOUT_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
