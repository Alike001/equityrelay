import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), preview: vi.fn(), build: vi.fn(), simulate: vi.fn(), serverReview: vi.fn(),
  begin: vi.fn(), prepare: vi.fn(), save: vi.fn(), step: vi.fn(), action: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/execution/repository", () => ({ getExecutionRoute: mocks.get, saveExecutionRoute: mocks.save, createExecutionStep: mocks.step }));
vi.mock("@/lib/binance/preview", () => ({ buildPreview: mocks.preview }));
vi.mock("@/lib/binance/swap-build", () => ({ buildSwapTransaction: mocks.build }));
vi.mock("@/lib/binance/simulation", () => ({ simulateEvmTransaction: mocks.simulate }));
vi.mock("@/lib/execution/review", () => ({ createServerReview: mocks.serverReview }));
vi.mock("@/domain/execution/lifecycle", () => ({ beginExecutionSession: mocks.begin, prepareReview: mocks.prepare }));
vi.mock("@/domain/execution/action", () => ({ executionActionV1: mocks.action }));
vi.mock("@/domain/preflight/validate", () => ({ derivePerLegSlippagePercent: () => "0.5" }));
import { prepareInitialExecutionReview } from "./initial-review";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const router = "0x2222222222222222222222222222222222222222" as const;
function setup() {
  mocks.get.mockResolvedValue({ session: { intent: { amount: "0.05", takerAddress: wallet } }, state: "ROUTE_POLICY_PASS", version: 0 });
  mocks.preview.mockResolvedValue({ kind: "decision", state: "PASS", evidence: { leg1: { quoteId: "fresh-quote" } } });
  mocks.build.mockResolvedValue({ evmTx: { from: wallet, to: router, data: "0x1234", value: "0" }, actions: [
    { kind: "APPROVAL", authorization: { status: "BOUNDED_READY" }, amountInRaw: "5", tokenInLabel: "NVDAon", gasLimit: "50000" },
    { kind: "SWAP", to: router, amountInRaw: "5", minAmountOutHuman: "11", tokenInLabel: "NVDAon", gasLimit: "300000" }] });
  mocks.simulate.mockResolvedValue({ status: "BLOCKED_BY_WALLET_STATE" });
  mocks.serverReview.mockResolvedValue({ allowanceSufficient: false });
  mocks.begin.mockReturnValue({ stage: "ROUTE_POLICY_PASS" });
  mocks.prepare.mockReturnValue({ stage: "LEG1_REVIEW" });
  mocks.save.mockResolvedValue(1);
  mocks.action.mockReturnValue({ stage: "LEG1_APPROVAL" });
  mocks.step.mockResolvedValue({ id: "step-1", stage: "LEG1_APPROVAL", action: { kind: "APPROVAL", amountInRaw: "5" }, actionHash: "0xhash" });
}
describe("first authenticated action review", () => {
  it("reacquires the quote and persists the bounded approval before the swap", async () => {
    setup();
    const review = await prepareInitialExecutionReview("route-1", wallet);
    expect(mocks.preview).toHaveBeenCalledWith({ amount: "0.05", takerAddress: wallet });
    expect(mocks.build).toHaveBeenCalledWith({ quoteId: "fresh-quote" }, wallet, "0.5");
    expect(mocks.action).toHaveBeenCalledWith(expect.objectContaining({ stage: "LEG1_APPROVAL", planIdentity: "fresh-quote" }));
    expect(mocks.step).toHaveBeenCalled();
    expect(review).toMatchObject({ actionKind: "APPROVAL", executionArmed: false });
  });
  it("refuses a blocked refreshed route without creating a step", async () => {
    setup();
    mocks.preview.mockResolvedValueOnce({ kind: "blocked", state: "BLOCKED" });
    mocks.step.mockClear();
    await expect(prepareInitialExecutionReview("route-1", wallet)).rejects.toThrow("FRESH_ROUTE_POLICY_PASS_REQUIRED");
    expect(mocks.step).not.toHaveBeenCalled();
  });
});
