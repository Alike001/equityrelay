import { z } from "zod";
import { toRawUnits, rawToDecimal, decimalText } from "@/domain/exposure/decimal";
import { isAddress, NVDAB_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import { discoverRepresentations } from "@/lib/binance/rwa";
import { discoverVenusInvestment } from "@/lib/binance/defi";
import { buildVenusRedeem } from "@/lib/binance/defi-redeem";
import { requestQuote } from "@/lib/binance/trading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Input = z.object({ address: z.string().refine(isAddress), amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/) }).strict();

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development" || !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(new URL(request.url).host))
    return Response.json({ message: "Local read-only unwind proof only." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = Input.safeParse(body);
  if (!parsed.success) return Response.json({ message: "Enter a valid BSC address and NVDAB amount." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  try {
    const owner = parsed.data.address as `0x${string}`;
    const { target } = await discoverRepresentations();
    const destination = await discoverVenusInvestment();
    if (!destination?.investable) return Response.json({ state: "DESTINATION_UNAVAILABLE" }, { headers: { "Cache-Control": "private, no-store" } });
    const amountRaw = toRawUnits(parsed.data.amount, target.decimals);
    const redeem = await buildVenusRedeem(owner, destination, target, amountRaw);
    const quote = await requestQuote(1, NVDAB_ADDRESS, USDT_ADDRESS, redeem.expectedUnderlyingOutRaw, owner);
    return Response.json({
      state: redeem.buildStatus === "READY" && quote ? "EXIT_PREFLIGHT_READY" : "EXIT_UNAVAILABLE",
      destination: { protocol: destination.protocol, investable: destination.investable, observedAt: destination.observedAt },
      redeem,
      exitQuote: quote ? { inputNvdab: decimalText(rawToDecimal(redeem.expectedUnderlyingOutRaw, target.decimals)), outputUsdt: decimalText(rawToDecimal(quote.outputRaw, quote.outputDecimals ?? 18)), observedAt: quote.observedAt, expiresAt: quote.expiresAt } : null,
      observedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Exit proof unavailable";
    return Response.json({ state: "EXIT_UNAVAILABLE", reason }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
