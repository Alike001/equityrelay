// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ExecutionSafetyProofPage from "./page";

describe("execution safety proof", () => {
  it("separates API provenance from deployed-contract provenance and shows the refusal", () => {
    render(<ExecutionSafetyProofPage />);

    expect(screen.getByText("AUTHENTICATED API PROVENANCE")).toBeTruthy();
    expect(screen.getByText("DEPLOYED CONTRACT PROVENANCE")).toBeTruthy();
    expect(screen.getAllByText("EXECUTION REFUSED").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("SECURITY_REFUSED_UNVERIFIED_ROUTER").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("NO APPROVAL · NO SIGNATURE · NO BROADCAST"),
    ).toBeTruthy();
  });
});
