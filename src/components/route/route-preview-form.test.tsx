// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RoutePreviewForm } from "./route-preview-form";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
  }, 15_000);

  it("separates route policy, historical verifier capability and authorization review", async () => {
    const body = { kind:"decision",state:"PASS",underlying:"NVDA",displayName:"NVIDIA",executionVerifierStatus:"VALIDATED",reasons:["PASS_ROUTE_READY"],amount:"0.022",maxExposureLossBps:50,sourceShares:"0.022",targetShares:"0.02198",retentionPercent:"99.90",exposureLossPercent:"0.10",observedAt:"2026-10-09T12:00:00Z",expiresAt:null,
      evidence:{ source:{chainId:56,underlying:"NVDA",issuer:"ondo",symbol:"NVDAon",address:"0xa9ee28c80f960b889dfbd1902055218cba016f75",decimals:18,tokenToShareRatio:"1",open:true,observedAt:"2026-10-09T12:00:00Z"},target:{chainId:56,underlying:"NVDA",issuer:"bstock",symbol:"NVDAB",address:"0x02fca66c1d1afb4e2a7884261eb00f63598a7436",decimals:18,tokenToShareRatio:"1",open:true,observedAt:"2026-10-09T12:00:00Z"},destination:{protocol:"Venus",chainId:56,investmentId:"venus",assetAddress:"0x02fca66c1d1afb4e2a7884261eb00f63598a7436",investable:true,observedAt:"2026-10-09T12:00:00Z"},leg1:{},leg2:{},sourceRaw:"22000000000000000"} };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status:200,headers:{"Content-Type":"application/json"} })));
    render(<RoutePreviewForm />);
    fireEvent.change(screen.getByLabelText("Wallet address for live quote"), { target:{ value:"0x1111111111111111111111111111111111111111" } });
    fireEvent.submit(screen.getByRole("button", { name:/Build route/ }).closest("form")!);
    await waitFor(() => expect(screen.getByText("Route available")).toBeTruthy());
    expect(screen.getByText("Validated · historical evidence")).toBeTruthy();
    fireEvent.click(screen.getByText("Why this route?"));
    expect(screen.getByText("POLICY DECISION")).toBeTruthy();
    expect(screen.getByText("AUTHORIZATION DECISION")).toBeTruthy();
    expect(screen.getByText("Separate review required")).toBeTruthy();
  });
});
