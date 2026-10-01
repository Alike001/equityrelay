import { describe, expect, it, vi } from "vitest";
import type { Eip1193Provider } from "./providers";
import { handoffSelectedWalletTransaction, prepareLockedWalletHandoff } from "./transaction-handoff";

const transaction = { from: "0x1111111111111111111111111111111111111111", to: "0x2222222222222222222222222222222222222222",
  data: "0x12345678", value: "0x0", chainId: "0x38" } as const;
describe("selected-provider transaction handoff", () => {
  it("checks only the selected provider and never invokes eth_sendTransaction while locked", async () => {
    const selected = { request: vi.fn(async ({ method }: { method: string }) => method === "eth_accounts" ? [transaction.from] : "0x38") } as Eip1193Provider;
    const other = { request: vi.fn() } as Eip1193Provider;
    await expect(handoffSelectedWalletTransaction(selected,transaction)).rejects.toThrow("PHASE3E_WALLET_SEND_DISABLED");
    expect(selected.request).toHaveBeenCalledTimes(2);
    expect(selected.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_sendTransaction" }));
    expect(other.request).not.toHaveBeenCalled();
  });
  it("refuses a wrong chain or session wallet before the hard stop", async () => {
    const wrongChain = { request: vi.fn(async ({ method }: { method: string }) => method === "eth_accounts" ? [transaction.from] : "0x1") } as Eip1193Provider;
    await expect(handoffSelectedWalletTransaction(wrongChain,transaction)).rejects.toThrow("BSC_CHAIN_REQUIRED");
    const wrongWallet = { request: vi.fn(async ({ method }: { method: string }) => method === "eth_accounts" ?
      ["0x3333333333333333333333333333333333333333"] : "0x38") } as Eip1193Provider;
    await expect(handoffSelectedWalletTransaction(wrongWallet,transaction)).rejects.toThrow("SESSION_WALLET_MISMATCH");
  });
  it("retrieves server authority end to end and still stops before the selected wallet send", async () => {
    const selected = { request: vi.fn(async ({ method }: { method: string }) => method === "eth_accounts" ? [transaction.from] : "0x38") } as Eip1193Provider;
    const responses = [
      new Response(JSON.stringify({ confirmationToken: "secret-once", actionHash: `0x${"a".repeat(64)}`,
        routeVersion: 7, stepId: "step-id", stage: "LEG1_SWAP" }), { status: 200 }),
      new Response(JSON.stringify({ transaction }), { status: 200 }),
    ];
    const fetcher = vi.fn(async () => responses.shift()!);
    await expect(prepareLockedWalletHandoff({ provider: selected, routeId: "route-id", stage: "LEG1_SWAP",
      idempotencyKey: "11111111-1111-4111-8111-111111111111", fetcher: fetcher as typeof fetch }))
      .rejects.toThrow("PHASE3E_WALLET_SEND_DISABLED");
    expect(fetcher).toHaveBeenNthCalledWith(1,"/api/execution/routes/route-id/confirmations",expect.objectContaining({ method:"POST" }));
    expect(fetcher).toHaveBeenNthCalledWith(2,"/api/execution/routes/route-id/actions/step-id",expect.objectContaining({ method:"POST" }));
    expect(selected.request).not.toHaveBeenCalledWith(expect.objectContaining({ method:"eth_sendTransaction" }));
  });
});
