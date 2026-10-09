// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterRecheck } from "./router-recheck";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("router recheck interaction", () => {
  it("runs only after a click and makes no wallet request", async () => {
    const walletRequest = vi.fn();
    vi.stubGlobal("ethereum", { request: walletRequest });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "MATCH", chainId: 56, blockNumber: "123", checkedAt: "2026-10-09T12:00:00Z",
      address: "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5",
      recordedHash: `0x${"11".repeat(32)}`, computedHash: `0x${"11".repeat(32)}`, currentFacets: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RouterRecheck />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Recheck router/ }));
    await waitFor(() => expect(screen.getByText("MATCH")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/proof/router-check", expect.objectContaining({ method: "POST", body: "{}" }));
    expect(walletRequest).not.toHaveBeenCalled();
  });
  it("shows unavailable without manufacturing a pass", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<RouterRecheck />);
    fireEvent.click(screen.getByRole("button", { name: /Recheck router/ }));
    await waitFor(() => expect(screen.getByText("RPC_UNAVAILABLE")).toBeTruthy());
    expect(screen.queryByText("MATCH")).toBeNull();
  });
});
