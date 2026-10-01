import { describe, expect, it, vi } from "vitest";
import type { Eip1193Provider } from "./providers";
import { handoffSelectedWalletTransaction, prepareLockedWalletHandoff } from "./transaction-handoff";

const transaction = { from: "0x1111111111111111111111111111111111111111", to: "0x2222222222222222222222222222222222222222",
  data: "0x12345678", value: "0x0", chainId: "0x38" } as const;
describe("selected-provider transaction handoff", () => {
  it("sends the exact server transaction through only the selected provider", async () => {
    const hash = `0x${"a".repeat(64)}`;
    const selected = { request: vi.fn(async ({ method }: { method: string }) => method === "eth_accounts" ? [transaction.from] :
      method === "eth_chainId" ? "0x38" : hash) } as Eip1193Provider;
    const other = { request: vi.fn() } as Eip1193Provider;
    await expect(handoffSelectedWalletTransaction(selected,transaction)).resolves.toBe(hash);
    expect(selected.request).toHaveBeenCalledWith({ method: "eth_sendTransaction", params: [transaction] });
    expect(other.request).not.toHaveBeenCalled();
  });
  it("refuses a wrong chain or session wallet before wallet handoff", async () => {
    const wrongChain = { request: vi.fn(async ({ method }: { method: string }) => method === "eth_accounts" ? [transaction.from] : "0x1") } as Eip1193Provider;
    await expect(handoffSelectedWalletTransaction(wrongChain,transaction)).rejects.toThrow("BSC_CHAIN_REQUIRED");
    const wrongWallet = { request: vi.fn(async ({ method }: { method: string }) => method === "eth_accounts" ?
      ["0x3333333333333333333333333333333333333333"] : "0x38") } as Eip1193Provider;
    await expect(handoffSelectedWalletTransaction(wrongWallet,transaction)).rejects.toThrow("SESSION_WALLET_MISMATCH");
  });
  it.each(["NVDA","SPCX"])("retrieves a live-PASS %s server action before invoking the selected wallet", async () => {
    const hash = `0x${"b".repeat(64)}`;
    const selected = { request: vi.fn(async ({ method }: { method: string }) => method === "eth_accounts" ? [transaction.from] :
      method === "eth_chainId" ? "0x38" : hash) } as Eip1193Provider;
    const responses = [
      new Response(JSON.stringify({ confirmationToken: "secret-once", actionHash: `0x${"a".repeat(64)}`,
        routeVersion: 7, stepId: "step-id", stage: "LEG1_SWAP" }), { status: 200 }),
      new Response(JSON.stringify({ transaction }), { status: 200 }),
    ];
    const fetcher = vi.fn(async () => responses.shift()!);
    await expect(prepareLockedWalletHandoff({ provider: selected, routeId: "route-id", stage: "LEG1_SWAP",
      idempotencyKey: "11111111-1111-4111-8111-111111111111", fetcher: fetcher as typeof fetch }))
      .resolves.toBe(hash);
    expect(fetcher).toHaveBeenNthCalledWith(1,"/api/execution/routes/route-id/confirmations",expect.objectContaining({ method:"POST" }));
    expect(fetcher).toHaveBeenNthCalledWith(2,"/api/execution/routes/route-id/actions/step-id",expect.objectContaining({ method:"POST" }));
    expect(selected.request).toHaveBeenCalledWith({ method: "eth_sendTransaction", params: [transaction] });
  });
  it("cannot reach wallet send when a validated asset has no current live route", async () => {
    const selected = { request: vi.fn() } as Eip1193Provider;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ confirmationToken: "secret-once", actionHash: `0x${"a".repeat(64)}`,
        routeVersion: 7, stepId: "step-id", stage: "LEG1_SWAP" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "ROUTE_POLICY_NOT_PASS" }), { status: 409 }));
    await expect(prepareLockedWalletHandoff({ provider: selected, routeId: "tsla-route", stage: "LEG1_SWAP",
      idempotencyKey: "11111111-1111-4111-8111-111111111111", fetcher: fetcher as typeof fetch }))
      .rejects.toThrow("ROUTE_POLICY_NOT_PASS");
    expect(selected.request).not.toHaveBeenCalled();
  });
});
