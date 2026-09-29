import { createHash, randomBytes } from "node:crypto";
import type { ExecutionActionV1 } from "./action";

export type ConfirmationIntent = {
  id: string; tokenHash: string; routeId: string; wallet: string; stage: ExecutionActionV1["stage"];
  actionHash: string; routeVersion: number; idempotencyKey: string; expiresAt: string; usedAt: string | null;
};

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function randomSecret(): string { return randomBytes(32).toString("base64url"); }
export function createConfirmationIntent(input: Omit<ConfirmationIntent, "id" | "tokenHash" | "usedAt">): { token: string; intent: ConfirmationIntent } {
  if (!input.routeId || !input.wallet || !input.actionHash || !input.idempotencyKey || input.routeVersion < 0 ||
      Date.parse(input.expiresAt) <= Date.now()) throw new Error("INVALID_CONFIRMATION_INTENT");
  const token = randomSecret();
  return { token, intent: { ...input, id: crypto.randomUUID(), tokenHash: hashSecret(token), usedAt: null } };
}
export function checkConfirmationIntent(intent: ConfirmationIntent, input: {
  token: string; routeId: string; wallet: string; stage: ExecutionActionV1["stage"];
  actionHash: string; routeVersion: number; now?: Date;
}): void {
  if (intent.usedAt) throw new Error("CONFIRMATION_ALREADY_USED");
  if (Date.parse(intent.expiresAt) <= (input.now ?? new Date()).getTime()) throw new Error("CONFIRMATION_EXPIRED");
  if (hashSecret(input.token) !== intent.tokenHash || intent.routeId !== input.routeId ||
      intent.wallet.toLowerCase() !== input.wallet.toLowerCase() || intent.stage !== input.stage ||
      intent.actionHash !== input.actionHash || intent.routeVersion !== input.routeVersion) throw new Error("CONFIRMATION_BINDING_MISMATCH");
}
