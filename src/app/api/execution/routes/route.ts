import { cookies } from "next/headers";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { beginExecutionSession } from "@/domain/execution/lifecycle";
import { buildPreview } from "@/lib/binance/preview";
import { requireSameOrigin, sessionCookie, sessionWallet } from "@/lib/auth/siwe";
import { createExecutionRoute } from "@/lib/execution/repository";
import type { Address } from "@/types/route";

export const runtime = "nodejs";
const Input = z.strictObject({ underlying: z.literal("NVDA"), sourceRepresentation: z.literal("ondo"),
  amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/), destination: z.literal("venus"),
  maxExposureLossBps: z.number().int().min(0).max(10000) });

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const wallet = await sessionWallet((await cookies()).get(sessionCookie)?.value);
    if (!wallet) return Response.json({ code: "WALLET_AUTH_REQUIRED" }, { status: 401 });
    const input = Input.parse(await request.json());
    const preview = await buildPreview({ ...input, takerAddress: wallet as Address });
    if (preview.kind !== "decision" || preview.state !== "PASS") return Response.json({ code: "ROUTE_POLICY_NOT_PASS", preview }, { status: 409 });
    const session = beginExecutionSession(randomUUID(), wallet as Address, preview);
    await createExecutionRoute(session);
    return Response.json({ routeId: session.id, state: session.stage, executionArmed: false }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && error.message === "EXECUTION_DATABASE_UNAVAILABLE" ? error.message : "EXECUTION_ROUTE_UNAVAILABLE";
    return Response.json({ code }, { status: code === "EXECUTION_DATABASE_UNAVAILABLE" ? 503 : 400, headers: { "Cache-Control": "no-store" } });
  }
}
