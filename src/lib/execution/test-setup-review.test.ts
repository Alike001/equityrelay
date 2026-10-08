import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get:vi.fn(),persist:vi.fn(),readContract:vi.fn(),quote:vi.fn(),build:vi.fn(),review:vi.fn(),
  prepare:vi.fn(),semantic:vi.fn(),gas:vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./repository", () => ({ getExecutionRoute:mocks.get,persistPreparedReview:mocks.persist }));
vi.mock("./rpc", () => ({ bscPublicClient: () => ({ readContract:mocks.readContract }),readBscWithRetry:(read:()=>Promise<unknown>)=>read() }));
vi.mock("@/lib/binance/trading", () => ({ requestQuote:mocks.quote }));
vi.mock("@/lib/binance/swap-build", () => ({ buildSwapTransaction:mocks.build }));
vi.mock("./review", () => ({ createServerReview:mocks.review }));
vi.mock("@/domain/execution/test-setup", () => ({ prepareTestSetup:mocks.prepare }));
vi.mock("@/domain/execution/action", () => ({ executionActionV1:mocks.semantic }));
vi.mock("./approval-gas", () => ({ ensureApprovalGasLimit:mocks.gas }));
import { prepareDurableTestSetupReview } from "./test-setup-review";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const token = "0x55d398326f99059ff775485246999027b3197955" as const;
const spender = "0x2222222222222222222222222222222222222222" as const;

describe("initial TEST_SETUP review", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("preserves duplicate creation protection while a setup review exists", async () => {
    mocks.get.mockResolvedValue({ state:"ROUTE_POLICY_PASS",session:{ testSetup:{ state:"SETUP_REVIEW_READY" } } });
    await expect(prepareDurableTestSetupReview("route",wallet)).rejects.toThrow("TEST_SETUP_NOT_REVIEWABLE");
  });
  it("displays the same positive gas limit persisted for confirmation readiness", async () => {
    const now = new Date(), quote = { leg:2,from:token,to:"0xa9ee28c80f960b889dfbd1902055218cba016f75",inputRaw:"5",
      outputRaw:"22",inputDecimals:18,outputDecimals:18,inputSymbol:"USDT",outputSymbol:"NVDAon",vendor:"Binance",quoteId:"fresh",
      tradeFeeUsd:null,priceImpactPercent:null,observedAt:now.toISOString(),expiresAt:new Date(now.getTime()+60_000).toISOString() };
    const approval = { kind:"APPROVAL",tokenInLabel:"USDT",gasLimit:null,gasPrice:null,maxFeePerGas:null,maxPriorityFeePerGas:null,
      authorization:{ status:"BOUNDED_READY" },approvalSpender:spender,approvalAmountRaw:"5" };
    const swap = { kind:"SWAP",tokenInLabel:"USDT",tokenOutLabel:"NVDAon",gasLimit:"300000" };
    const session = { intent:{ underlying:"NVDA" },testSetup:null,originalSource:{ address:quote.to },originalSourceRaw:"22",
      initialQuote:{ outputRaw:"5" } };
    mocks.get.mockResolvedValue({ state:"ROUTE_POLICY_PASS",session,version:3 });
    mocks.readContract.mockResolvedValue(0n); mocks.quote.mockResolvedValue(quote);
    mocks.build.mockResolvedValue({ evmTx:{},actions:[approval,swap] });
    mocks.review.mockResolvedValue({ allowanceSufficient:false }); mocks.prepare.mockReturnValue({ ...session,testSetup:{} });
    mocks.gas.mockImplementation(async action => ({ ...action,gasLimit:"55200" }));
    mocks.semantic.mockReturnValue({ stage:"TEST_SETUP_APPROVAL" });
    mocks.persist.mockResolvedValue({ id:"new-step",actionHash:`0x${"a".repeat(64)}` });
    const result = await prepareDurableTestSetupReview("route",wallet);
    expect(mocks.persist).toHaveBeenCalledWith("route",wallet,3,expect.anything(),expect.anything(),
      expect.objectContaining({ gas:expect.objectContaining({ gasLimit:"55200" }) }));
    expect(result).toMatchObject({ stage:"TEST_SETUP_APPROVAL",gasLimit:"55200",approvalSpender:spender,approvalAmountRaw:"5" });
  });
});
