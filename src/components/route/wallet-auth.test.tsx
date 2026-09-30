// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WalletAuth } from "./wallet-auth";
import { providerSelectionKey, type Eip1193Provider } from "@/lib/wallet/providers";

const wallet = "0x1111111111111111111111111111111111111111";
const discoveryListeners: EventListener[] = [];
function injected(name: string) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const calls: string[] = [];
  const provider: Eip1193Provider = {
    request: vi.fn(async ({ method }) => {
      calls.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [wallet];
      if (method === "eth_chainId") return "0x38";
      if (method === "personal_sign") return `0x${"a".repeat(130)}`;
      return null;
    }),
    on: (event, listener) => listeners.set(event, listener),
    removeListener: (event, listener) => { if (listeners.get(event) === listener) listeners.delete(event); },
  };
  return { name, provider, calls, emit: (event: string, value: unknown) => listeners.get(event)?.(value) };
}
function installEip6963(...wallets: ReturnType<typeof injected>[]) {
  const listener = (() => wallets.forEach((item, index) => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
    detail: { info: { uuid: `${item.name}-${index}`, name: item.name, icon: "", rdns: `wallet.${index}` }, provider: item.provider },
  })))) as EventListener;
  discoveryListeners.push(listener);
  window.addEventListener("eip6963:requestProvider", listener);
}
function mockFetch(sessionWallet: string | null = null) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith("/session")) return new Response(JSON.stringify({ wallet: sessionWallet }), { status: 200 });
    if (path.endsWith("/challenge")) return new Response(JSON.stringify({ message: "SIWE login message" }), { status: 200 });
    if (path.endsWith("/verify")) return new Response(JSON.stringify({ wallet }), { status: 200 });
    return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
  });
}

beforeEach(() => { localStorage.clear(); vi.stubGlobal("fetch", mockFetch()); });
afterEach(() => {
  cleanup();
  for (const listener of discoveryListeners.splice(0)) window.removeEventListener("eip6963:requestProvider", listener);
  vi.unstubAllGlobals();
});

describe("wallet picker and disconnect", () => {
  it("shows no-provider feedback", async () => {
    render(<WalletAuth />);
    await waitFor(() => expect(screen.getByText("No EVM wallet detected")).toBeTruthy());
  });
  it("shows a chooser for Binance and MetaMask and sends requests only to the selected wallet", async () => {
    const binance = injected("Binance Wallet"), metamask = injected("MetaMask");
    installEip6963(binance, metamask);
    render(<WalletAuth />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect wallet" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(screen.getByRole("dialog", { name: "Choose an EVM wallet" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Binance Wallet" }));
    await waitFor(() => expect(screen.getByText(shortWallet())).toBeTruthy());
    expect(binance.calls).toContain("personal_sign");
    expect(metamask.calls).toEqual([]);
  });
  it("disconnects EquityRelay, clears provider selection, and sends no wallet RPC", async () => {
    const binance = injected("Binance Wallet");
    installEip6963(binance);
    render(<WalletAuth />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect wallet" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy());
    const before = [...binance.calls];
    const authChanged = vi.fn();
    window.addEventListener("equityrelay-auth-changed", authChanged);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull());
    expect(localStorage.getItem(providerSelectionKey)).toBeNull();
    expect(binance.calls).toEqual(before);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" }));
    expect(authChanged).toHaveBeenCalled();
    window.removeEventListener("equityrelay-auth-changed", authChanged);
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy());
    expect(binance.calls.filter(method => method === "personal_sign")).toHaveLength(2);
  });
  it("account and chain changes revoke the server session", async () => {
    const binance = injected("Binance Wallet");
    installEip6963(binance);
    render(<WalletAuth />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect wallet" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy());
    binance.emit("accountsChanged", ["0x2222222222222222222222222222222222222222"]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" }));
  });
  it("restores the exact selected provider and invalidates on a chain change", async () => {
    const binance = injected("Binance Wallet"), metamask = injected("MetaMask");
    installEip6963(binance, metamask);
    localStorage.setItem(providerSelectionKey, JSON.stringify({ id: "eip6963:Binance Wallet-0", uuid: "Binance Wallet-0", rdns: "wallet.0", source: "EIP6963" }));
    vi.stubGlobal("fetch", mockFetch(wallet));
    render(<WalletAuth />);
    await waitFor(() => expect(screen.getByText(shortWallet())).toBeTruthy());
    expect(binance.calls).toEqual(["eth_accounts", "eth_chainId"]);
    expect(metamask.calls).toEqual([]);
    binance.emit("chainChanged", "0x1");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull());
    expect(localStorage.getItem(providerSelectionKey)).toBeNull();
  });
});

function shortWallet() { return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`; }
