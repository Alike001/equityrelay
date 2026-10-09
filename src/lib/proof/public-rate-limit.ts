import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { transaction } from "@/lib/db/pool";
import { consumeChallengeRate } from "@/lib/auth/rate-limit";

const trustedHeaders = new Set(["x-forwarded-for", "x-real-ip", "cf-connecting-ip", "x-vercel-forwarded-for"]);

export function publicProofRateKeys(request: Request): Array<{ key: string; limit: number }> {
  const keys = [{ key: "proof:router:global", limit: 3_000 }];
  const header = process.env.EQUITYRELAY_TRUSTED_CLIENT_IP_HEADER?.toLowerCase();
  if (process.env.NODE_ENV === "production" && (!header || !trustedHeaders.has(header))) throw new Error("PROOF_RATE_LIMIT_CONFIGURATION_REQUIRED");
  if (!header) return keys;
  const ip = request.headers.get(header)?.split(",")[0]?.trim();
  const secret = process.env.EQUITYRELAY_RATE_LIMIT_SECRET;
  if (!ip || !isIP(ip) || !secret || secret.length < 32) throw new Error("PROOF_RATE_LIMIT_CONFIGURATION_REQUIRED");
  const hash = createHmac("sha256", secret).update(ip).digest("hex");
  return [{ key: `proof:router:ip:${hash}`, limit: 30 }, ...keys];
}

export async function consumePublicProofRate(request: Request): Promise<void> {
  const keys = publicProofRateKeys(request);
  await transaction(client => consumeChallengeRate(client, keys));
}
