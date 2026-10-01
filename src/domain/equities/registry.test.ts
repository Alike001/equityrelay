import { describe, expect, it } from "vitest";
import { assertExecutionVerifierValidated, equityConfig, executionVerifierValidated, isSupportedUnderlying, SUPPORTED_UNDERLYINGS } from "./registry";

describe("supported equity registry", () => {
  it("contains only the reviewed read-only allowlist", () => {
    expect(SUPPORTED_UNDERLYINGS).toEqual(["NVDA", "SPCX", "TSLA"]);
    expect(isSupportedUnderlying("NVDA")).toBe(true);
    expect(isSupportedUnderlying("AAPL")).toBe(false);
  });

  it("marks only historically validated verifier profiles execution eligible", () => {
    for (const underlying of SUPPORTED_UNDERLYINGS) {
      expect(executionVerifierValidated(underlying)).toBe(true);
      expect(() => assertExecutionVerifierValidated(underlying)).not.toThrow();
    }
    expect(equityConfig("SPCX").routePreviewSupported).toBe(true);
  });
});
