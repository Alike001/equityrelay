import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), accept: vi.fn(), reconcile: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "opaque" }) }) }));
vi.mock("@/lib/auth/siwe", () => ({ sessionCookie: "equityrelay_session", requireSameOrigin: () => {}, sessionWallet: mocks.session }));
vi.mock("@/lib/execution/reconcile", () => ({ acceptReportedHash: mocks.accept, reconcileStoredStep: mocks.reconcile }));
import { POST } from "./route";

const routeId="11111111-1111-4111-8111-111111111111",stepId="22222222-2222-4222-8222-222222222222";
const wallet="0x1111111111111111111111111111111111111111",txHash=`0x${"1".repeat(64)}`;
const context={params:Promise.resolve({id:routeId,stepId})};
function request(body:unknown){return new Request("https://equityrelay.example/transaction",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});}
describe("transaction hash lookup-hint API",()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue(wallet);mocks.reconcile.mockResolvedValue("PENDING");});
  it("accepts only a hash hint and reconciles under the authenticated wallet",async()=>{
    const response=await POST(request({operation:"REPORT",txHash}),context);
    expect(response.status).toBe(200);
    expect(mocks.accept).toHaveBeenCalledWith(routeId,wallet,stepId,txHash);
    expect(mocks.reconcile).toHaveBeenCalledWith(routeId,wallet,stepId);
    expect(await response.json()).toEqual({state:"WAITING_FOR_CANONICAL_CONFIRMATION",txHashAcceptedAsLookupHint:true});
  });
  it.each(["to","data","value","token","approvalAmount","spender","quoteId","stage"])("rejects browser authority field %s",async field=>{
    const response=await POST(request({operation:"REPORT",txHash,[field]:"forged"}),context);
    expect(response.status).toBe(409);expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("requires authentication and supports idempotent reconciliation without another hash",async()=>{
    mocks.session.mockResolvedValueOnce(null);expect((await POST(request({operation:"RECONCILE"}),context)).status).toBe(401);
    mocks.reconcile.mockResolvedValueOnce("CONFIRMED");
    expect(await (await POST(request({operation:"RECONCILE"}),context)).json()).toEqual({state:"CONFIRMED",txHashAcceptedAsLookupHint:false});
  });
});
