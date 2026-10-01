import { describe, expect, it } from "vitest";
import { assertExecutionVerifierValidated, equityConfig, executionVerifierValidated, isSupportedUnderlying, SUPPORTED_UNDERLYINGS } from "./registry";

describe("supported equity registry", () => {
  it("contains only the reviewed read-only allowlist", () => {
    expect(SUPPORTED_UNDERLYINGS).toEqual(["NVDA", "SPCX", "TSLA"]);
    expect(isSupportedUnderlying("NVDA")).toBe(true);
    expect(isSupportedUnderlying("AAPL")).toBe(false);
  });

  it("keeps execution eligibility narrower than preview eligibility", () => {
    expect(executionVerifierValidated("NVDA")).toBe(true);
    expect(executionVerifierValidated("SPCX")).toBe(false);
    expect(executionVerifierValidated("TSLA")).toBe(false);
    expect(() => assertExecutionVerifierValidated("SPCX")).toThrow("EXECUTION_VERIFIER_NOT_VALIDATED");
    expect(() => assertExecutionVerifierValidated("TSLA")).toThrow("EXECUTION_VERIFIER_NOT_VALIDATED");
    expect(() => assertExecutionVerifierValidated("NVDA")).not.toThrow();
    expect(equityConfig("SPCX").routePreviewSupported).toBe(true);
  });
});
