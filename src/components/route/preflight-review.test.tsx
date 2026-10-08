// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PreflightAction, PreflightStage, RoutePreflight } from "@/types/preflight";

const mocks = vi.hoisted(() => ({ selected: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/wallet/selected-provider", () => ({ getSelectedWalletProvider: mocks.selected }));
vi.mock("@/lib/wallet/setup-approval-flow", () => ({ runSetupApproval: mocks.run }));
import { PreflightReview } from "./preflight-review";

const wallet = "0x1111111111111111111111111111111111111111";
const action = { kind:"SWAP",chainId:56,from:wallet,to:"0x2222222222222222222222222222222222222222",valueWei:"0",
  calldataSummary:"swap",rawCalldata:"0x12345678",gasLimit:"100000",gasPrice:"1",maxPriorityFeePerGas:null,maxFeePerGas:null,
  tokenIn:"0xa9ee28c80f960b889dfbd1902055218cba016f75",tokenOut:"0x55d398326f99059ff775485246999027b3197955",
  amountInRaw:"22000000000000000",minAmountOutRaw:"5",amountInHuman:"0.022",minAmountOutHuman:"5",slippagePercent:"0.5",
  tokenInLabel:"NVDAon",tokenOutLabel:"USDT",approvalSpender:null,approvalAmountRaw:null,approvalExceedsInput:false,authorization:null,
  simulation:{status:"PASSED",failReason:null,balanceChanges:[],allowanceChanges:[],warnings:[]},simulationPrerequisite:"SIMULATABLE_NOW" } satisfies PreflightAction;
const stage = { label:"Stage",indicative:false,buildStatus:"READY",actions:[action],simulationStatus:"PASSED",
  simulationPrerequisite:"SIMULATABLE_NOW",authorizationStatus:"BOUNDED_READY",rejectedAuthorization:null,reason:null,previewDetails:null } satisfies PreflightStage;
const data: RoutePreflight = { kind:"preflight",routePolicy:"PASS",routePreview:{ underlying:"NVDA",displayName:"NVIDIA",
  executionVerifierStatus:"VALIDATED",amount:"0.022",maxExposureLossBps:50,sourceShares:"0.022",targetShares:"0.02199",
  retentionPercent:"99.9",exposureLossPercent:"0.1",observedAt:new Date().toISOString() },leg1:stage,leg2Indicative:stage,
  venusDepositIndicative:stage,overallPreflightState:"READY_TO_REVIEW",authorizationSafety:"BOUNDED_READY",executionReadiness:"NOT_READY",
  safetyWarnings:[],observedAt:new Date().toISOString() };

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status,headers:{"Content-Type":"application/json"} }); }

describe("first test setup operator flow", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.selected.mockReturnValue({ id:"binance",provider:{ request:vi.fn() } }); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("requests TEST_SETUP and displays an exact approval without sending before an explicit click", async () => {
    const review = { state:"TEST_SETUP_REVIEW_READY",stepId:"step",stage:"TEST_SETUP_APPROVAL",actionKind:"APPROVAL",
      actionHash:`0x${"a".repeat(64)}`,routeVersion:2,usdtInputRaw:"5015",usdtInputHuman:"5.015",expectedSourceRaw:"22",
      expectedSourceHuman:"0.022",sourceSymbol:"NVDAon",chainId:56,tokenLabel:"USDT",approvalSpender:"0x3333333333333333333333333333333333333333",
      approvalAmountRaw:"5015",gasLimit:"50000",quoteObservedAt:new Date().toISOString(),quoteExpiresAt:new Date(Date.now()+30_000).toISOString() };
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/auth/session")) return response({ wallet });
      if (url.endsWith("/api/health/execution-readiness")) return response({ status:"READY_READ_ONLY",executionArmed:false,
        walletSendCodeReleased:true,deprecatedRelayLocked:true,canonicalRpcStatus:"READY" });
      if (url.endsWith("/api/execution/routes")) return response({ routeId:"route" });
      if (url.endsWith("/review")) return response(review);
      throw new Error(`unexpected ${url} ${init?.body ?? ""}`);
    });
    vi.stubGlobal("fetch",fetcher);
    render(<PreflightReview result={data} />);
    await waitFor(() => expect(screen.getByText(/signed-in wallet matches/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{name:"Save read-only review"}));
    await screen.findByRole("button",{name:"Review test setup"});
    fireEvent.click(screen.getByRole("button",{name:"Review test setup"}));
    expect(await screen.findByText("TEST_SETUP_APPROVAL")).toBeTruthy();
    const reviewCall = fetcher.mock.calls.find(call => String(call[0]).endsWith("/review"));
    expect(JSON.parse(String(reviewCall?.[1]?.body))).toEqual({ phase:"TEST_SETUP" });
    expect(screen.getByText("5.015 USDT")).toBeTruthy();
    expect(screen.getByText("Execution disabled.")).toBeTruthy();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("does not mislabel or send TEST_SETUP_SWAP when allowance is already sufficient", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith("/api/auth/session")) return response({ wallet });
      if (url.endsWith("/api/health/execution-readiness")) return response({ status:"READY_ARMED",executionArmed:true,
        walletSendCodeReleased:true,deprecatedRelayLocked:true,canonicalRpcStatus:"READY" });
      if (url.endsWith("/api/execution/routes")) return response({ routeId:"route" });
      if (url.endsWith("/review")) return response({ state:"TEST_SETUP_REVIEW_READY",stage:"TEST_SETUP_SWAP",actionKind:"SWAP",
        actionHash:`0x${"b".repeat(64)}`,sourceSymbol:"NVDAon" });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch",fetcher);
    render(<PreflightReview result={data} />);
    await waitFor(() => expect(screen.getByText(/signed-in wallet matches/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{name:"Save read-only review"}));
    fireEvent.click(await screen.findByRole("button",{name:"Review test setup"}));
    expect(await screen.findByText("Setup approval is not required")).toBeTruthy();
    expect(screen.queryByRole("button",{name:/Review exact USDT approval/})).toBeNull();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("uses the explicit REFRESH operation for an expired setup review without opening the wallet", async () => {
    const reviews = [{ state:"TEST_SETUP_REVIEW_READY",stage:"TEST_SETUP_APPROVAL",actionKind:"APPROVAL",
      actionHash:`0x${"a".repeat(64)}`,routeVersion:2,usdtInputHuman:"5.01",expectedSourceHuman:"0.022",sourceSymbol:"NVDAon",
      approvalSpender:"0x3333333333333333333333333333333333333333",gasLimit:"50000",quoteFreshness:"FRESH",
      quoteExpiresAt:"2020-01-01T00:00:00.000Z" },
    { state:"TEST_SETUP_REVIEW_READY",stage:"TEST_SETUP_APPROVAL",actionKind:"APPROVAL",actionHash:`0x${"b".repeat(64)}`,
      routeVersion:4,usdtInputHuman:"5.02",expectedSourceHuman:"0.022",sourceSymbol:"NVDAon",
      approvalSpender:"0x3333333333333333333333333333333333333333",gasLimit:"50001",quoteFreshness:"FRESH",
      quoteExpiresAt:new Date(Date.now()+30_000).toISOString() }];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith("/api/auth/session")) return response({ wallet });
      if (url.endsWith("/api/health/execution-readiness")) return response({ status:"READY_ARMED",executionArmed:true,
        walletSendCodeReleased:true,deprecatedRelayLocked:true,canonicalRpcStatus:"READY" });
      if (url.endsWith("/api/execution/routes")) return response({ routeId:"route" });
      if (url.endsWith("/review")) return response(reviews.shift());
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch",fetcher);
    render(<PreflightReview result={data} />);
    await waitFor(() => expect(screen.getByText(/signed-in wallet matches/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{name:"Save read-only review"}));
    fireEvent.click(await screen.findByRole("button",{name:"Review test setup"}));
    fireEvent.click(await screen.findByRole("button",{name:"Review exact USDT approval in wallet"}));
    fireEvent.click(await screen.findByRole("button",{name:"Refresh setup review"}));
    await waitFor(() => expect(screen.getByText("5.02 USDT")).toBeTruthy());
    const reviewCalls = fetcher.mock.calls.filter(call => String(call[0]).endsWith("/review"));
    expect(JSON.parse(String(reviewCalls[1]?.[1]?.body))).toEqual({ phase:"TEST_SETUP",operation:"REFRESH" });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("blocks wallet handoff when the server cannot persist approval gas evidence", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init; const url = String(input);
      if (url.endsWith("/api/auth/session")) return response({ wallet });
      if (url.endsWith("/api/health/execution-readiness")) return response({ status:"READY_ARMED",executionArmed:true,
        walletSendCodeReleased:true,deprecatedRelayLocked:true,canonicalRpcStatus:"READY" });
      if (url.endsWith("/api/execution/routes")) return response({ routeId:"route" });
      if (url.endsWith("/review")) return response({ code:"GAS_ESTIMATE_UNAVAILABLE" },409);
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch",fetcher);
    render(<PreflightReview result={data} />);
    await waitFor(() => expect(screen.getByText(/signed-in wallet matches/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{name:"Save read-only review"}));
    fireEvent.click(await screen.findByRole("button",{name:"Review test setup"}));
    expect((await screen.findByRole("alert")).textContent).toContain("BLOCKED · GAS ESTIMATE UNAVAILABLE");
    expect(screen.queryByRole("button",{name:"Review exact USDT approval in wallet"})).toBeNull();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("does not expose the send button if an approval response lacks positive persisted gas", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init; const url = String(input);
      if (url.endsWith("/api/auth/session")) return response({ wallet });
      if (url.endsWith("/api/health/execution-readiness")) return response({ status:"READY_ARMED",executionArmed:true,
        walletSendCodeReleased:true,deprecatedRelayLocked:true,canonicalRpcStatus:"READY" });
      if (url.endsWith("/api/execution/routes")) return response({ routeId:"route" });
      if (url.endsWith("/review")) return response({ state:"TEST_SETUP_REVIEW_READY",stage:"TEST_SETUP_APPROVAL",actionKind:"APPROVAL",
        actionHash:`0x${"a".repeat(64)}`,routeVersion:2,usdtInputHuman:"5.01",expectedSourceHuman:"0.022",sourceSymbol:"NVDAon",
        approvalSpender:"0x3333333333333333333333333333333333333333",gasLimit:null,quoteFreshness:"FRESH" });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch",fetcher); render(<PreflightReview result={data} />);
    await waitFor(() => expect(screen.getByText(/signed-in wallet matches/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{name:"Save read-only review"}));
    fireEvent.click(await screen.findByRole("button",{name:"Review test setup"}));
    expect((await screen.findByRole("alert")).textContent).toContain("GAS ESTIMATE UNAVAILABLE");
    expect(screen.queryByRole("button",{name:"Review exact USDT approval in wallet"})).toBeNull();
  });
});
