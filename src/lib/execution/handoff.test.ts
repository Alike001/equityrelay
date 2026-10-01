import { beforeEach,describe,expect,it,vi } from "vitest";
import type { ExecutionActionV1 } from "@/domain/execution/action";
import type { ExecutionSession } from "@/types/execution";
const mocks=vi.hoisted(()=>({query:vi.fn(),reserve:vi.fn(),readiness:vi.fn(),discover:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/db/pool",()=>({executionPool:()=>({query:mocks.query})}));
vi.mock("@/lib/execution/repository",()=>({reserveConfirmation:mocks.reserve}));
vi.mock("@/lib/execution/readiness",async importOriginal=>{
  const actual=await importOriginal<typeof import("./readiness")>();
  return {...actual,requireActionReadiness:mocks.readiness};
});
vi.mock("@/lib/binance/defi",()=>({discoverVenusInvestment:mocks.discover}));
import { executionActionHash } from "@/domain/execution/action";
import { deliverWalletAction } from "./handoff";

const wallet="0x1111111111111111111111111111111111111111";
const action={version:"ExecutionActionV1",routeId:"11111111-1111-4111-8111-111111111111",stage:"LEG1_SWAP",kind:"SWAP",chainId:56,
  from:wallet,to:"0x2222222222222222222222222222222222222222",data:"0x12345678",valueWei:"0",tokenIn:"0x3333333333333333333333333333333333333333",
  tokenOut:"0x4444444444444444444444444444444444444444",amountInRaw:"1",approvalSpender:null,approvalAmountRaw:null,planIdentity:"quote",planRevision:"revision"} satisfies ExecutionActionV1;
const hash=executionActionHash(action),now=new Date();
const session={id:action.routeId,owner:wallet,stage:"LEG1_REVIEW",initialQuote:{quoteId:"quote",observedAt:now.toISOString(),expiresAt:null},
  intent:{underlying:"NVDA",sourceRepresentation:"ondo",amount:"1",destination:"venus",maxExposureLossBps:50,takerAddress:wallet},
  originalSourceRaw:"1",reviews:{LEAVE_ONDO:{allowanceSufficient:true}},confirmations:[]} as unknown as ExecutionSession;
function row(override:Record<string,unknown>={}){return {session_snapshot:session,version:"4",action_v1:action,action_hash:hash,status:"REVIEW_READY",
  tx_hash:null,recommended_gas:{gasLimit:"100000"},used_at:null,expires_at:new Date(Date.now()+20_000),...override};}
const input={routeId:action.routeId,stepId:"22222222-2222-4222-8222-222222222222",wallet,stage:"LEG1_SWAP" as const,
  token:"x".repeat(40),actionHash:hash,routeVersion:4};
describe("final server action delivery",()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.query.mockReset().mockResolvedValueOnce({rowCount:1,rows:[row()]}).mockResolvedValueOnce({rows:[]});});
  it("returns exact persisted transaction fields after final checks and atomic reservation",async()=>{
    const result=await deliverWalletAction(input);
    expect(result.transaction).toEqual({from:wallet,to:action.to,data:action.data,value:"0x0",chainId:"0x38"});
    expect(mocks.readiness).toHaveBeenCalledWith(action,"100000");
    expect(mocks.reserve).toHaveBeenCalledWith(input);
  });
  it.each([
    ["wrong wallet",{...input,wallet:"0x5555555555555555555555555555555555555555"}],
    ["wrong route",{...input,routeId:"22222222-2222-4222-8222-222222222222"}],
    ["wrong stage",{...input,stage:"LEG2_SWAP" as const}],
    ["old route version",{...input,routeVersion:3}],
    ["stale action hash",{...input,actionHash:`0x${"f".repeat(64)}` as `0x${string}`}],
  ])("rejects %s",async(_label,changed)=>{await expect(deliverWalletAction(changed)).rejects.toThrow("ACTION_DELIVERY_BINDING_MISMATCH");});
  it("rejects expired quote and an already consumed or pending action",async()=>{
    mocks.query.mockReset().mockResolvedValueOnce({rowCount:1,rows:[row({expires_at:new Date(Date.now()-1)})]});
    await expect(deliverWalletAction(input)).rejects.toThrow("QUOTE_REFRESH_REQUIRED");
    mocks.query.mockReset().mockResolvedValueOnce({rowCount:1,rows:[row({used_at:new Date()})]});
    await expect(deliverWalletAction(input)).rejects.toThrow("ACTION_ALREADY_RESERVED_OR_SUBMITTED");
    mocks.query.mockReset().mockResolvedValueOnce({rowCount:1,rows:[row({status:"PENDING",tx_hash:`0x${"1".repeat(64)}`})]});
    await expect(deliverWalletAction(input)).rejects.toThrow("ACTION_ALREADY_RESERVED_OR_SUBMITTED");
  });
  it.each(["SPCX","TSLA"] as const)("delivers a persisted action for validated %s without changing its semantics",async underlying=>{
    mocks.query.mockReset().mockResolvedValueOnce({rowCount:1,rows:[row({session_snapshot:{...session,intent:{...session.intent,underlying}}})]}).mockResolvedValueOnce({rows:[]});
    const delivered=await deliverWalletAction(input);
    expect(delivered.transaction).toEqual({from:wallet,to:action.to,data:action.data,value:"0x0",chainId:"0x38"});
    expect(mocks.reserve).toHaveBeenCalledOnce();
  });
});
