// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RoutePreviewForm } from "./route-preview-form";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("multi-equity route selector", () => {
  it("shows only the supported registry assets and sends the selected ticker", async () => {
    const fetchMock = vi.fn(async (...requestArgs: [string, RequestInit?]) => {
      void requestArgs;
      return new Response(JSON.stringify({
        kind: "blocked", state: "BLOCKED", reasons: ["BLOCK_NO_LEG1_QUOTE"], message: "No route",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<RoutePreviewForm />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /NVIDIA/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Tesla/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /SPCX/ })).toBeTruthy();
    expect(screen.queryByText("Apple")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Tesla/ }));
    fireEvent.change(screen.getByLabelText("Amount of your current TSLA representation"), { target: { value: "0.03" } });
    fireEvent.change(screen.getByLabelText("Wallet address for live quote"), { target: { value: "0x1111111111111111111111111111111111111111" } });
    fireEvent.submit(screen.getByRole("button", { name: /Build route/ }).closest("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ underlying: "TSLA", amount: "0.03" });
  });
});
