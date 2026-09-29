import { BrowserIntentSchema } from "@/lib/intent";
import { buildPreview } from "@/lib/binance/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let input: unknown;
  try { input = await request.json(); }
  catch { return Response.json({ message: "Enter a valid route request." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  const parsed = BrowserIntentSchema.safeParse(input);
  if (!parsed.success) return Response.json({ message: "Check the amount, policy and BSC address." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const result = await buildPreview(parsed.data as Parameters<typeof buildPreview>[0]);
  if (result.kind === "decision") {
    // Quote IDs are retained only in server-side evidence; the browser gets a safe read-only subset.
    result.evidence.leg1.quoteId = null;
    result.evidence.leg2.quoteId = null;
  }
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
