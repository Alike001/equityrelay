import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ pool:vi.fn(),transaction:vi.fn(),readiness:vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pool", () => ({ executionPool: () => ({ query:mocks.pool }),transaction:mocks.transaction }));
vi.mock("@/domain/execution/action", () => ({ executionActionHash: () => "0xhash" }));
vi.mock("@/domain/routing/identity", () => ({ sameAddress: () => true }));
vi.mock("@/domain/execution/step-order", () => ({ requireStepOrder: () => {} }));
vi.mock("@/domain/equities/registry", () => ({ assertExecutionVerifierValidated: () => {} }));
vi.mock("@/domain/execution/confirmation", () => ({ hashSecret:vi.fn(),createConfirmationIntent: (input: Record<string,unknown>) => ({
  token:"raw-token",intent:{ ...input,id:"intent",tokenHash:"hash",usedAt:null } }) }));
vi.mock("@/lib/execution/readiness", () => ({ quoteForAction: () => null,requireCurrentQuote:vi.fn(),
  requireActionReadiness:mocks.readiness,confirmationExpiryForAction: () => new Date(Date.now()+60_000) }));
vi.mock("@/domain/execution/lifecycle", () => ({ recordConfirmation:vi.fn() }));
vi.mock("@/domain/execution/recovery", () => ({ recoveryAfterProductStop:vi.fn(),reserveRecoveryConfirmation:vi.fn() }));
vi.mock("@/domain/execution/test-setup", () => ({ reserveTestSetup:vi.fn() }));
vi.mock("./lost-hash", () => ({ findReservedTransaction:vi.fn() }));
import { issueConfirmation } from "./repository";

describe("confirmation uses persisted approval gas", () => {
  it("accepts and forwards the positive recommended gas stored with the reviewed action", async () => {
    const wallet="0x1111111111111111111111111111111111111111", action={ routeId:"route",stage:"TEST_SETUP_APPROVAL",
      kind:"APPROVAL",from:wallet,planIdentity:"quote" }, session={ intent:{ underlying:"NVDA" } };
    mocks.pool.mockResolvedValue({ rowCount:1,rows:[{ session_snapshot:session,version:"4",action_v1:action,
      action_hash:"0xhash",recommended_gas:{ gasLimit:"55200" } }] });
    mocks.transaction.mockImplementation(async (work: (client:{query:(text:string)=>Promise<unknown>})=>Promise<unknown>) => work({
      query:async text => {
        if (text.startsWith("SELECT version,lifecycle_state")) return { rowCount:1,rows:[{ version:"4" }] };
        if (text.startsWith("SELECT step_id")) return { rowCount:1,rows:[{ step_id:"step",action_v1:action,action_hash:"0xhash",status:"REVIEW_READY" }] };
        if (text.startsWith("SELECT session_snapshot")) return { rowCount:1,rows:[{ session_snapshot:session }] };
        return { rowCount:0,rows:[] };
      },
    }));
    const issued = await issueConfirmation("route",wallet,"TEST_SETUP_APPROVAL","11111111-1111-4111-8111-111111111111");
    expect(mocks.readiness).toHaveBeenCalledWith(action,"55200");
    expect(issued).toMatchObject({ token:"raw-token",routeVersion:4,step:{ id:"step",stage:"TEST_SETUP_APPROVAL" } });
  });
});
