import { cookies } from "next/headers";
import { sessionCookie, sessionWallet } from "@/lib/auth/siwe";

export const runtime = "nodejs";
export async function GET(): Promise<Response> {
  try {
    const wallet = await sessionWallet((await cookies()).get(sessionCookie)?.value);
    return Response.json({ authenticated: !!wallet, wallet, chainId: wallet ? 56 : null }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ code: "EXECUTION_DATABASE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
