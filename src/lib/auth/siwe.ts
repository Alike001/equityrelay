import "server-only";
import { randomBytes } from "node:crypto";
import { createSiweMessage, parseSiweMessage, verifySiweMessage } from "viem/siwe";
import { isAddress, sameAddress } from "@/domain/routing/identity";
import { hashSecret, randomSecret } from "@/domain/execution/confirmation";
import { executionPool, transaction } from "@/lib/db/pool";
import { bscPublicClient } from "@/lib/execution/rpc";

const challengeSeconds = 300;
const sessionSeconds = 8 * 60 * 60;
export const sessionCookie = "equityrelay_session";

export function configuredOrigin(): URL {
  const value = process.env.EQUITYRELAY_PUBLIC_ORIGIN;
  if (!value) throw new Error("PUBLIC_ORIGIN_UNAVAILABLE");
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")))
    throw new Error("INVALID_PUBLIC_ORIGIN");
  return url;
}
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== configuredOrigin().origin) throw new Error("ORIGIN_MISMATCH");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new Error("CONTENT_TYPE_REQUIRED");
}
export async function createChallenge(wallet: string): Promise<{ message: string; expiresAt: string }> {
  if (!isAddress(wallet)) throw new Error("INVALID_WALLET_CLAIM");
  const origin = configuredOrigin();
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date();
  const expirationTime = new Date(issuedAt.getTime() + challengeSeconds * 1000);
  const message = createSiweMessage({ address: wallet, chainId: 56, domain: origin.host,
    uri: origin.origin, version: "1", nonce, issuedAt, expirationTime,
    statement: "Sign in to EquityRelay for read-only route review." });
  await executionPool().query(`INSERT INTO auth_challenges
    (nonce_hash,wallet,chain_id,domain,uri,message,issued_at,expires_at)
    VALUES ($1,$2,56,$3,$4,$5,$6,$7)`,
    [hashSecret(nonce), wallet.toLowerCase(), origin.host, origin.origin, message, issuedAt, expirationTime]);
  return { message, expiresAt: expirationTime.toISOString() };
}
export async function verifyChallenge(message: string, signature: `0x${string}`): Promise<{ wallet: string; sessionToken: string; expiresAt: Date }> {
  const parsed = parseSiweMessage(message);
  if (!parsed.nonce || !parsed.address || !parsed.expirationTime || parsed.chainId !== 56 ||
      parsed.domain !== configuredOrigin().host || parsed.uri !== configuredOrigin().origin) throw new Error("INVALID_SIWE_CHALLENGE");
  const candidate = await executionPool().query("SELECT wallet,message,expires_at,consumed_at FROM auth_challenges WHERE nonce_hash=$1", [hashSecret(parsed.nonce)]);
  const row = candidate.rows[0] as { wallet: string; message: string; expires_at: Date; consumed_at: Date | null } | undefined;
  if (!row || row.consumed_at || row.expires_at.getTime() <= Date.now() || row.message !== message || !sameAddress(row.wallet, parsed.address)) throw new Error("SIWE_CHALLENGE_EXPIRED_OR_USED");
  const valid = await verifySiweMessage(bscPublicClient(), { message, signature, address: parsed.address as `0x${string}`,
    domain: configuredOrigin().host, nonce: parsed.nonce });
  if (!valid) throw new Error("SIWE_SIGNATURE_INVALID");
  const sessionToken = randomSecret();
  const expiresAt = new Date(Date.now() + sessionSeconds * 1000);
  await transaction(async client => {
    const consumed = await client.query("UPDATE auth_challenges SET consumed_at=now() WHERE nonce_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING wallet", [hashSecret(parsed.nonce!)]);
    if (consumed.rowCount !== 1) throw new Error("SIWE_CHALLENGE_EXPIRED_OR_USED");
    await client.query("INSERT INTO auth_sessions(session_hash,wallet,chain_id,expires_at) VALUES ($1,$2,56,$3)",
      [hashSecret(sessionToken), row.wallet, expiresAt]);
  });
  return { wallet: row.wallet, sessionToken, expiresAt };
}
export async function sessionWallet(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const found = await executionPool().query("SELECT wallet FROM auth_sessions WHERE session_hash=$1 AND revoked_at IS NULL AND expires_at>now() AND chain_id=56", [hashSecret(token)]);
  return (found.rows[0] as { wallet: string } | undefined)?.wallet ?? null;
}
export async function revokeSession(token: string | undefined): Promise<void> {
  if (token) await executionPool().query("UPDATE auth_sessions SET revoked_at=now() WHERE session_hash=$1 AND revoked_at IS NULL", [hashSecret(token)]);
}
