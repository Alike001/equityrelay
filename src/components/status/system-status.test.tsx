// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkedAvailability, SystemStatus } from "./system-status";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("public system status", () => {
  it("models not checked, unavailable and stale without inventing health", () => {
    expect(checkedAvailability(null, false, 10)).toBe("NOT_CHECKED");
    expect(checkedAvailability(1, false, 10)).toBe("UNAVAILABLE");
    expect(checkedAvailability(1, true, 130_002)).toBe("STALE");
    expect(checkedAvailability(1, true, 20)).toBe("AVAILABLE");
  });
  it("does not probe automatically and shows a failed explicit check as unavailable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<SystemStatus configuredExecutionArmed={false} configuredConfirmations={3} configuredFinalized />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByText("NOT CHECKED").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Check system now/ }));
    await waitFor(() => expect(screen.getAllByText("UNAVAILABLE").length).toBeGreaterThan(0));
    expect(screen.getByText("DISARMED")).toBeTruthy();
  });
});
