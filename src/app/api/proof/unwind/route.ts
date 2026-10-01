import { z } from "zod";
import { toRawUnits, rawToDecimal, decimalText } from "@/domain/exposure/decimal";
import { isAddress, NVDAB_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import { discoverRepresentations } from "@/lib/binance/rwa";
import { discoverVenusInvestment } from "@/lib/binance/defi";
import { buildVenusRedeem } from "@/lib/binance/defi-redeem";
import { requestQuote } from "@/lib/binance/trading";
import { buildSwapTransaction } from "@/lib/binance/swap-build";
import { currentBscGasPrice } from "@/lib/binance/gas";
import { summarizeGasEvidence, type ClassifiedGasEvidence } from "@/domain/readiness/gas-evidence";

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
    const exitBuild = quote ? await buildSwapTransaction(quote,owner,"0.5") : null;
    const gasPrice = await currentBscGasPrice().catch(() => null);
    const observedAt = new Date().toISOString();
    const classifiedGas: ClassifiedGasEvidence[] = [
      { action: "VENUS_REDEEM", gasUnits: redeem.gasLimit, classification: redeem.gasLimit ? "LIVE_CURRENT" : "UNAVAILABLE",
        observedAt, source: redeem.gasLimit ? "Binance DeFi redeem build" : "Current redeem build" },
      ...(exitBuild?.actions.map((action,index) => ({ action: `EXIT_${index + 1}_${action.kind}`,
        gasUnits: action.gasLimit, classification: action.gasLimit ? "LIVE_CURRENT" as const : "UNAVAILABLE" as const,
        observedAt, source: action.gasLimit ? "Binance Trading transaction build" : "Current wallet state did not yield a gas limit" })) ?? []),
    ];
    return Response.json({
      state: redeem.buildStatus === "READY" && quote ? "EXIT_PREFLIGHT_READY" : "EXIT_UNAVAILABLE",
      destination: { protocol: destination.protocol, investable: destination.investable, observedAt: destination.observedAt },
      redeem,
      gasEvidence: {
        gasPrice,
        classified: classifiedGas,
        summary: gasPrice ? summarizeGasEvidence(classifiedGas,gasPrice.priceWei) : null,
        historicalCanonical: { action: "VENUS_REDEEM", gasUnits: "231465", classification: "HISTORICAL_CANONICAL",
          observedAt: "2026-09-30T00:00:00.000Z", source: "BSC receipt 0xa70c…3336 at block 124638518" },
        redeem: { gasLimit: redeem.gasLimit, classification: redeem.gasLimit ? "LIVE_CURRENT" : "UNAVAILABLE" },
        exit: exitBuild?.actions.map(action => ({ kind: action.kind, gasLimit: action.gasLimit,
          classification: action.gasLimit ? "LIVE_CURRENT" : "UNAVAILABLE" })) ?? [],
      },
      exitQuote: quote ? { inputNvdab: decimalText(rawToDecimal(redeem.expectedUnderlyingOutRaw, target.decimals)), outputUsdt: decimalText(rawToDecimal(quote.outputRaw, quote.outputDecimals ?? 18)), observedAt: quote.observedAt, expiresAt: quote.expiresAt } : null,
      observedAt,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Exit proof unavailable";
    return Response.json({ state: "EXIT_UNAVAILABLE", reason }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
