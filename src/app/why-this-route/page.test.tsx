// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import WhyThisRoutePage from "./page";

describe("route decision explanation", () => {
  it("keeps policy, verifier, authorization and execution meanings distinct", () => {
    render(<WhyThisRoutePage />);
    expect(screen.getByText("PASS or BLOCKED")).toBeTruthy();
    expect(screen.getByText("VALIDATED HISTORICALLY")).toBeTruthy();
    expect(screen.getByText("RECORDED REFUSAL")).toBeTruthy();
    expect(screen.getByText("DISARMED")).toBeTruthy();
    expect(screen.getByText(/dated 2026-09-29 feasibility study/)).toBeTruthy();
    expect(screen.getByText(/operator cancelled before signing/)).toBeTruthy();
  });
});
