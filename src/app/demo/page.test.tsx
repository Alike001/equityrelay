// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DemoPage from "./page";

describe("judge demo page", () => {
  beforeEach(() => { delete process.env.NEXT_PUBLIC_EQUITYRELAY_DEMO_VIDEO_URL; });
  afterEach(cleanup);
  it("links the complete judge journey without a fake player", () => {
    const { container } = render(<DemoPage />);
    expect(screen.getByRole("heading", { name: "See EquityRelay decide." })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Build a live route/ }).getAttribute("href")).toBe("/app");
    expect(screen.getByRole("link", { name: /Why this route/ }).getAttribute("href")).toBe("/why-this-route");
    expect(screen.getByRole("link", { name: /Execution safety/ }).getAttribute("href")).toBe("/proof/execution-safety");
    expect(screen.getByRole("link", { name: /Venus verification/ }).getAttribute("href")).toBe("/proof/venus-verifier");
    expect(container.querySelector("iframe,video")).toBeNull();
    expect(screen.getByText(/No placeholder playback or fabricated footage/)).toBeTruthy();
  });
});
