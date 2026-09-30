import { describe, expect, it, vi } from "vitest";
import { authenticateSelectedProvider, disconnectSelectedProvider, requestBscSwitch, revokeSelectedProviderPermission, validateSelectedProviderSession } from "./auth";
import type { Eip1193Provider } from "./providers";

const wallet = "0x1111111111111111111111111111111111111111";
function selected(chain = "0x38") {
  const calls: string[] = [];
  const provider: Eip1193Provider = { request: vi.fn(async ({ method }) => {
    calls.push(method);
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [wallet];
    if (method === "eth_chainId") return chain;
    if (method === "personal_sign") return `0x${"a".repeat(130)}`;
    return null;
  }) };
  return { provider, calls };
}
function fetcher() {
  return vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith("challenge") ? { message: "SIWE login message" } : { wallet }), { status: 200 }));
}

describe("selected-provider SIWE client flow", () => {
  it("uses only the selected Binance provider for accounts, chain and personal_sign", async () => {
    const binance = selected(), metamask = selected(), fetch = fetcher();
    expect(await authenticateSelectedProvider(binance.provider, fetch)).toBe(wallet);
    expect(binance.calls).toEqual(["eth_requestAccounts", "eth_chainId", "personal_sign", "eth_accounts", "eth_chainId"]);
    expect(metamask.calls).toEqual([]);
  });
  it("can select MetaMask independently", async () => {
    const metamask = selected();
    await authenticateSelectedProvider(metamask.provider, fetcher());
    expect(metamask.calls).toContain("personal_sign");
  });
  it("refuses SIWE on the wrong chain before signing", async () => {
    const wrong = selected("0x1");
    await expect(authenticateSelectedProvider(wrong.provider, fetcher())).rejects.toThrow("Switch to BNB Smart Chain");
    expect(wrong.calls).not.toContain("personal_sign");
  });
  it("validates restored sessions through the selected provider", async () => {
    expect(await validateSelectedProviderSession(selected().provider, wallet)).toBe(true);
    expect(await validateSelectedProviderSession(selected("0x1").provider, wallet)).toBe(false);
  });
  it("requests only chain 0x38 and preserves a rejected switch", async () => {
    const request = vi.fn().mockRejectedValue(new Error("user rejected"));
    await expect(requestBscSwitch({ request })).rejects.toThrow("user rejected");
    expect(request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
  });
  it("logs out first, revokes only selected-provider account permission, and verifies empty accounts", async () => {
    const order: string[] = [];
    const provider: Eip1193Provider = { request: vi.fn(async ({ method }) => { order.push(method); return method === "eth_accounts" ? [] : null; }) };
    const fetch = vi.fn(async () => { order.push("server_logout"); return new Response("{}", { status: 200 }); });
    await expect(disconnectSelectedProvider(provider, fetch)).resolves.toEqual({ sessionRevoked: true,
      permission: { outcome: "SUPPORTED_AND_REVOKED", walletPermissionState: "REVOKED" } });
    expect(order).toEqual(["server_logout", "wallet_revokePermissions", "eth_accounts"]);
    expect(provider.request).toHaveBeenCalledWith({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  });
  it.each([
    [{ code: 4200, message: "unsupported method" }, "METHOD_UNSUPPORTED"],
    [{ code: -32601, message: "method not found" }, "METHOD_UNSUPPORTED"],
    [{ code: 4001, message: "user rejected" }, "USER_REJECTED"],
    [{ code: -32000, message: "provider failed" }, "PROVIDER_ERROR"],
  ] as const)("classifies permission failures without changing server logout", async (error, outcome) => {
    const provider: Eip1193Provider = { request: vi.fn().mockRejectedValue(error) };
    await expect(disconnectSelectedProvider(provider, async () => new Response("{}", { status: 200 }))).resolves.toEqual({ sessionRevoked: true,
      permission: { outcome, walletPermissionState: "UNKNOWN" } });
  });
  it("does not claim revocation when the account remains exposed", async () => {
    const provider: Eip1193Provider = { request: vi.fn(async ({ method }) => method === "eth_accounts" ? [wallet] : null) };
    await expect(revokeSelectedProviderPermission(provider)).resolves.toEqual({ outcome: "REQUEST_ACCEPTED_NOT_REVOKED", walletPermissionState: "STILL_CONNECTED" });
  });
});
