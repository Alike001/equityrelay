import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionActionV1 } from "@/domain/execution/action";
import type { ExecutionSession } from "@/types/execution";

const mocks = vi.hoisted(() => ({ poolQuery: vi.fn(), transaction: vi.fn(), setup: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pool", () => ({ executionPool: () => ({ query: mocks.poolQuery }), transaction: mocks.transaction }));
vi.mock("@/lib/execution/test-setup-review", () => ({ prepareDurableTestSetupReview: mocks.setup }));
vi.mock("@/lib/execution/initial-review", () => ({ prepareInitialExecutionReview: vi.fn() }));
vi.mock("@/lib/execution/post-settlement", () => ({ prepareDurableLeg2Review: vi.fn() }));
vi.mock("@/lib/execution/recovery-review", () => ({ prepareDurableExitReview: vi.fn() }));
import { refreshCurrentTestSetupReview } from "./refresh";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const routeId = "11111111-1111-4111-8111-111111111111";
const oldHash = `0x${"a".repeat(64)}`;
const quote = { leg:2,from:"0x55d398326f99059ff775485246999027b3197955",to:"0xa9ee28c80f960b889dfbd1902055218cba016f75",
  inputRaw:"5",outputRaw:"22",inputDecimals:18,outputDecimals:18,vendor:"Binance",quoteId:"old-quote",tradeFeeUsd:null,
  priceImpactPercent:null,observedAt:"2020-01-01T00:00:00.000Z",expiresAt:"2020-01-01T00:00:30.000Z" } as const;
const action = { version:"ExecutionActionV1",routeId,stage:"TEST_SETUP_APPROVAL",kind:"APPROVAL",chainId:56,from:wallet,
  to:"0x55d398326f99059ff775485246999027b3197955",data:"0x1234",valueWei:"0",
  tokenIn:"0x55d398326f99059ff775485246999027b3197955",tokenOut:null,amountInRaw:"5",
  approvalSpender:"0x2222222222222222222222222222222222222222",approvalAmountRaw:"5",planIdentity:"old-quote",planRevision:"old" } satisfies ExecutionActionV1;
const session = { stage:"ROUTE_POLICY_PASS",testSetup:{ state:"SETUP_REVIEW_READY",quote,review:{},settlement:null },
  reviews:{ TEST_SETUP:{} },confirmations:[],recovery:null } as unknown as ExecutionSession;

describe("explicit TEST_SETUP refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setup.mockResolvedValue({ stepId:"new-step",actionHash:`0x${"b".repeat(64)}`,routeVersion:6,
      quoteIdentity:"new-quote",quoteObservedAt:"2026-01-01T00:00:00.000Z" });
  });

  it("supersedes the stale review, consumes old intents, resets state, increments version, and rebuilds", async () => {
    mocks.poolQuery.mockResolvedValue({ rowCount:1,rows:[{ session_snapshot:session,step_id:"old-step",stage:"TEST_SETUP_APPROVAL",
      status:"REVIEW_READY",action_hash:oldHash,action_v1:action }] });
    const queries: Array<{ text:string; values:unknown[] }> = [];
    mocks.transaction.mockImplementation(async (work: (client: { query: (text:string,values:unknown[]) => Promise<unknown> }) => Promise<unknown>) =>
      work({ query: async (text,values) => {
        queries.push({ text,values });
        if (text.startsWith("SELECT version")) return { rowCount:1,rows:[{ version:"4",session_snapshot:session }] };
        if (text.startsWith("SELECT stage")) return { rowCount:1,rows:[{ stage:"TEST_SETUP_APPROVAL",action_hash:oldHash,status:"REVIEW_READY" }] };
        return { rowCount:1,rows:[] };
      } }));
    const result = await refreshCurrentTestSetupReview(routeId,wallet);
    expect(result).toMatchObject({ stepId:"new-step",actionHash:`0x${"b".repeat(64)}`,routeVersion:6,quoteIdentity:"new-quote" });
    expect(mocks.setup).toHaveBeenCalledWith(routeId,wallet);
    expect(queries.some(query => query.text.includes("status='SUPERSEDED'") && query.values[0] === "old-step")).toBe(true);
    expect(queries.some(query => query.text.includes("confirmation_intents") && query.text.includes("used_at"))).toBe(true);
    const routeUpdate = queries.find(query => query.text.includes("version=version+1"));
    expect(routeUpdate).toBeTruthy();
    expect(JSON.parse(String(routeUpdate?.values[2])).testSetup).toBeNull();
  });

  it.each(["AWAITING_WALLET_TX","SUBMITTED","PENDING","CONFIRMED"])("refuses %s for manual review", async status => {
    mocks.poolQuery.mockResolvedValue({ rowCount:1,rows:[{ session_snapshot:session,step_id:"old-step",stage:"TEST_SETUP_APPROVAL",
      status,action_hash:oldHash,action_v1:action }] });
    await expect(refreshCurrentTestSetupReview(routeId,wallet)).rejects.toThrow("TEST_SETUP_REFRESH_REQUIRES_MANUAL_REVIEW");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.setup).not.toHaveBeenCalled();
  });
});
