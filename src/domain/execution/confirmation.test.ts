import { describe, expect, it } from "vitest";
import { checkConfirmationIntent, createConfirmationIntent, hashSecret } from "./confirmation";

const input = { routeId: "route-1", wallet: "0x1111111111111111111111111111111111111111", stage: "LEG1_APPROVAL" as const,
  actionHash: "0xabc", routeVersion: 4, idempotencyKey: "click-1", expiresAt: new Date(Date.now() + 60_000).toISOString() };
describe("single-use confirmation bindings", () => {
  it("stores only a hash and binds every field", () => {
    const { token, intent } = createConfirmationIntent(input);
    expect(intent.tokenHash).toBe(hashSecret(token));
    expect(JSON.stringify(intent)).not.toContain(token);
    expect(() => checkConfirmationIntent(intent, { token, ...input })).not.toThrow();
    for (const field of ["routeId", "wallet", "stage", "actionHash", "routeVersion"] as const) {
      expect(() => checkConfirmationIntent(intent, { token, ...input, [field]: field === "routeVersion" ? 5 : "other" })).toThrow("CONFIRMATION_BINDING_MISMATCH");
    }
    expect(() => checkConfirmationIntent(intent, { token: "forged", ...input })).toThrow("CONFIRMATION_BINDING_MISMATCH");
  });
  it("rejects replay and expiry and cannot restore a consumed token", () => {
    const { token, intent } = createConfirmationIntent(input);
    const consumed = { ...intent, usedAt: new Date().toISOString() };
    expect(() => checkConfirmationIntent(consumed, { token, ...input })).toThrow("CONFIRMATION_ALREADY_USED");
    expect(() => checkConfirmationIntent(intent, { token, ...input, now: new Date(Date.now() + 90_000) })).toThrow("CONFIRMATION_EXPIRED");
    const replacement = createConfirmationIntent({ ...input, routeVersion: 5, idempotencyKey: "click-2" });
    expect(replacement.token).not.toBe(token);
    expect(() => checkConfirmationIntent(replacement.intent, { token, ...input, routeVersion: 5 })).toThrow();
  });
});
