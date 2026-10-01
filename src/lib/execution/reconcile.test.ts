import { beforeEach, describe, expect, it, vi } from "vitest";
import { executionActionHash, type ExecutionActionV1 } from "@/domain/execution/action";
import { equityConfig } from "@/domain/equities/registry";
import { USDT_ADDRESS } from "@/domain/routing/identity";

const mocks = vi.hoisted(() => ({ query: vi.fn(), observe: vi.fn(), transaction: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pool", () => ({ executionPool: () => ({ query: mocks.query }), transaction: mocks.transaction }));
vi.mock("@/lib/execution/canonical", () => ({ observeCanonicalTransaction: mocks.observe }));
vi.mock("@/lib/execution/round-trip-receipt", () => ({ persistRoundTripReceipt: vi.fn() }));
import { acceptReportedHash } from "./reconcile";

const wallet = "0x1111111111111111111111111111111111111111";
const existing = `0x${"1".repeat(64)}` as `0x${string}`;
const other = `0x${"2".repeat(64)}` as `0x${string}`;
const action = { version: "ExecutionActionV1", routeId: "11111111-1111-4111-8111-111111111111", stage: "LEG1_SWAP",
  kind: "SWAP", chainId: 56, from: wallet, to: "0x2222222222222222222222222222222222222222", data: "0x12345678",
  valueWei: "0", tokenIn: equityConfig("NVDA").sourceAddress, tokenOut: USDT_ADDRESS,
  amountInRaw: "1", approvalSpender: null, approvalAmountRaw: null, planIdentity: "quote", planRevision: "revision" } satisfies ExecutionActionV1;

describe("transaction hash acceptance", () => {
  beforeEach(() => vi.clearAllMocks());
  const session_snapshot = { intent: { underlying: "NVDA" } };
  it("treats a duplicate identical hash as idempotent without another canonical lookup", async () => {
    mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ action_v1: action, action_hash: executionActionHash(action),
      status: "SUBMITTED", tx_hash: existing, wallet, session_snapshot }] });
    await expect(acceptReportedHash(action.routeId,wallet,"step",existing)).resolves.toBeUndefined();
    expect(mocks.observe).not.toHaveBeenCalled();
  });
  it("rejects a second transaction for a submitted or pending stage", async () => {
    mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ action_v1: action, action_hash: executionActionHash(action),
      status: "PENDING", tx_hash: existing, wallet, session_snapshot }] });
    await expect(acceptReportedHash(action.routeId,wallet,"step",other)).rejects.toThrow("ACTION_RESERVATION_REQUIRED");
    expect(mocks.observe).not.toHaveBeenCalled();
  });
  it("rejects a canonical hash hint when the persisted action belongs to another asset", async () => {
    const crossAsset = { ...action, tokenIn: equityConfig("TSLA").sourceAddress };
    mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ action_v1: crossAsset, action_hash: executionActionHash(crossAsset),
      status: "AWAITING_WALLET_TX", tx_hash: null, wallet, session_snapshot }] });
    await expect(acceptReportedHash(action.routeId,wallet,"step",other)).rejects.toThrow("CROSS_ASSET_ACTION_MISMATCH");
    expect(mocks.observe).not.toHaveBeenCalled();
  });
});
