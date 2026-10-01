import { BrowserIntentSchema } from "@/lib/intent";
import { buildRoutePreflight } from "@/lib/binance/preflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let input: unknown;
  try { input = await request.json(); }
  catch { return Response.json({ message: "Enter a valid preflight request." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  const parsed = BrowserIntentSchema.safeParse(input);
  if (!parsed.success) return Response.json({ message: "Only a supported tokenized-equity route intent can be preflighted." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  return Response.json(await buildRoutePreflight(parsed.data as Parameters<typeof buildRoutePreflight>[0]), { headers: { "Cache-Control": "no-store" } });
}
