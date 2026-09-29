import { describe, expect, it, vi } from "vitest";
import type { QuoteSnapshot } from "@/types/route";
vi.mock("server-only", () => ({}));
import { requireCurrentQuote } from "./readiness";

const now = new Date("2026-09-29T18:00:30.000Z");
const quote = { quoteId: "fresh", observedAt: "2026-09-29T18:00:10.000Z", expiresAt: null } as QuoteSnapshot;
describe("execution quote review window", () => {
  it("accepts current quote, but not another, stale, expired or future quote", () => {
    expect(() => requireCurrentQuote(quote, "fresh", now)).not.toThrow();
    expect(() => requireCurrentQuote(quote, "old", now)).toThrow("QUOTE_REVIEW_EXPIRED");
    expect(() => requireCurrentQuote({ ...quote, observedAt: "2026-09-29T17:00:00.000Z" }, "fresh", now)).toThrow("QUOTE_REVIEW_EXPIRED");
    expect(() => requireCurrentQuote({ ...quote, expiresAt: "2026-09-29T18:00:29.000Z" }, "fresh", now)).toThrow("QUOTE_REVIEW_EXPIRED");
    expect(() => requireCurrentQuote({ ...quote, observedAt: "2026-09-29T18:01:00.000Z" }, "fresh", now)).toThrow("QUOTE_REVIEW_EXPIRED");
  });
});
