import { ReadinessIntentSchema } from "@/lib/intent";
import { buildMainnetReadiness } from "@/lib/binance/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // This surface contains live wallet balances and is available only in local development.
  if (process.env.NODE_ENV !== "development" || !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(new URL(request.url).host))
    return Response.json({ message: "Local proof readiness only." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = ReadinessIntentSchema.safeParse(body);
  if (!parsed.success) return Response.json({ message: "Enter a valid BSC wallet address." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  return Response.json(await buildMainnetReadiness(parsed.data.address as `0x${string}`), { headers: { "Cache-Control": "private, no-store" } });
}
