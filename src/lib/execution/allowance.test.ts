import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { allowanceCovers } from "./allowance";

describe("read-only allowance verdict", () => {
  it("skips approval only when current allowance covers exact spend", () => {
    expect(allowanceCovers("100", "100")).toBe(true);
    expect(allowanceCovers("101", "100")).toBe(true);
    expect(allowanceCovers("99", "100")).toBe(false);
    expect(() => allowanceCovers("1e3", "100")).toThrow("INVALID_ALLOWANCE_VALUE");
  });
});
