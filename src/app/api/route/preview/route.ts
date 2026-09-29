import { z } from "zod";
import { positiveDecimal } from "@/domain/exposure/decimal";
import { isAddress } from "@/domain/routing/identity";
import { buildPreview } from "@/lib/binance/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Intent = z.strictObject({
  underlying: z.literal("NVDA"), sourceRepresentation: z.literal("ondo"),
  amount: z.string().max(80).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(value => { try { positiveDecimal(value); return true; } catch { return false; } }), destination: z.literal("venus"),
  maxExposureLossBps: z.number().int().min(0).max(10000),
  takerAddress: z.string().refine(isAddress, "Enter a valid BSC address."),
});

export async function POST(request: Request): Promise<Response> {
  let input: unknown;
  try { input = await request.json(); }
  catch { return Response.json({ message: "Enter a valid route request." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  const parsed = Intent.safeParse(input);
  if (!parsed.success) return Response.json({ message: "Check the amount, policy and BSC address." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const result = await buildPreview(parsed.data as Parameters<typeof buildPreview>[0]);
  if (result.kind === "decision") {
    // Quote IDs are retained only in server-side evidence; the browser gets a safe read-only subset.
    result.evidence.leg1.quoteId = null;
    result.evidence.leg2.quoteId = null;
  }
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
