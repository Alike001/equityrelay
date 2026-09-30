import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type pg from "pg";

const windowMs = 10 * 60_000;
const trustedHeaders = new Set(["x-forwarded-for", "x-real-ip", "cf-connecting-ip", "x-vercel-forwarded-for"]);

export function challengeRateKeys(request: Request, wallet: string): Array<{ key: string; limit: number }> {
  const keys = [{ key: `wallet:${wallet.toLowerCase()}`, limit: 5 }, { key: "global", limit: 1000 }];
  const header = process.env.EQUITYRELAY_TRUSTED_CLIENT_IP_HEADER?.toLowerCase();
  if (process.env.NODE_ENV === "production" && (!header || !trustedHeaders.has(header))) throw new Error("AUTH_RATE_LIMIT_CONFIGURATION_REQUIRED");
  if (!header) return keys;
  if (!trustedHeaders.has(header)) throw new Error("AUTH_RATE_LIMIT_CONFIGURATION_REQUIRED");
  const ip = request.headers.get(header)?.split(",")[0]?.trim();
  const secret = process.env.EQUITYRELAY_RATE_LIMIT_SECRET;
  if (!ip || !isIP(ip) || !secret || secret.length < 32) throw new Error("AUTH_RATE_LIMIT_CONFIGURATION_REQUIRED");
  const hash = createHmac("sha256", secret).update(ip).digest("hex");
  return [{ key: `ip:${hash}`, limit: 20 }, ...keys];
}

export async function consumeChallengeRate(client: pg.PoolClient, keys: Array<{ key: string; limit: number }>, now = new Date()): Promise<void> {
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  for (const { key, limit } of [...keys].sort((a, b) => a.key.localeCompare(b.key))) {
    const result = await client.query(`INSERT INTO auth_challenge_limits(bucket_key,window_start,attempts) VALUES($1,$2,1)
      ON CONFLICT (bucket_key,window_start) DO UPDATE SET attempts=auth_challenge_limits.attempts+1
      WHERE auth_challenge_limits.attempts<$3 RETURNING attempts`, [key, windowStart, limit]);
    if (result.rowCount !== 1) throw new Error("AUTH_RATE_LIMITED");
  }
}
