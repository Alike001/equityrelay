import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./repository", () => ({ getExecutionRoute: mocks.get, persistPreparedReview: vi.fn() }));
vi.mock("./rpc", () => ({ bscPublicClient: vi.fn(), readBscWithRetry: vi.fn() }));
vi.mock("@/lib/binance/trading", () => ({ requestQuote: vi.fn() }));
vi.mock("@/lib/binance/swap-build", () => ({ buildSwapTransaction: vi.fn() }));
vi.mock("./review", () => ({ createServerReview: vi.fn() }));
import { prepareDurableTestSetupReview } from "./test-setup-review";

describe("initial TEST_SETUP review", () => {
  it("preserves duplicate creation protection while a setup review exists", async () => {
    mocks.get.mockResolvedValue({ state:"ROUTE_POLICY_PASS",session:{ testSetup:{ state:"SETUP_REVIEW_READY" } } });
    await expect(prepareDurableTestSetupReview("route","0x1111111111111111111111111111111111111111"))
      .rejects.toThrow("TEST_SETUP_NOT_REVIEWABLE");
  });
});
