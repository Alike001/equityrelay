import { describe, expect, it, vi } from "vitest";
import { discoverWalletProviders, providerSelection, restoreSelectedProvider, type Eip1193Provider, type WalletProviderOption } from "./providers";

function provider(flags: Partial<Eip1193Provider> = {}): Eip1193Provider {
  return { request: vi.fn(), ...flags };
}
function browser(ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] }): Window & { ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] } } {
  const target = new EventTarget() as Window & { ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] } };
  target.ethereum = ethereum;
  return target;
}
function announce(target: Window, info: { uuid: string; name: string; rdns: string }, injected: Eip1193Provider) {
  target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info: { ...info, icon: "data:image/svg+xml,<svg/>" }, provider: injected } }));
}

describe("EIP-6963 and legacy provider discovery", () => {
  it("returns no providers when no EVM wallet is installed", () => {
    let options: WalletProviderOption[] = [];
    discoverWalletProviders(browser(), value => { options = value; });
    expect(options).toEqual([]);
  });
  it("discovers one EIP-6963 provider and deduplicates repeat announcements", () => {
    const target = browser(), binance = provider();
    target.addEventListener("eip6963:requestProvider", () => {
      announce(target, { uuid: "binance-id", name: "Binance Wallet", rdns: "com.binance.wallet" }, binance);
      announce(target, { uuid: "binance-id", name: "Binance Wallet", rdns: "com.binance.wallet" }, binance);
    });
    let options: WalletProviderOption[] = [];
    discoverWalletProviders(target, value => { options = value; });
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ name: "Binance Wallet", source: "EIP6963", provider: binance });
  });
  it("keeps Binance and MetaMask distinct when both announce", () => {
    const target = browser(), binance = provider(), metamask = provider();
    target.addEventListener("eip6963:requestProvider", () => {
      announce(target, { uuid: "binance-id", name: "Binance Wallet", rdns: "com.binance.wallet" }, binance);
      announce(target, { uuid: "metamask-id", name: "MetaMask", rdns: "io.metamask" }, metamask);
    });
    let options: WalletProviderOption[] = [];
    discoverWalletProviders(target, value => { options = value; });
    expect(options.map(option => option.name)).toEqual(["Binance Wallet", "MetaMask"]);
    expect(restoreSelectedProvider(options, providerSelection(options[0]))?.provider).toBe(binance);
  });
  it("exposes legacy provider arrays individually and a single provider generically", () => {
    const binance = provider({ isBinance: true }), metamask = provider({ isMetaMask: true });
    let options: WalletProviderOption[] = [];
    discoverWalletProviders(browser({ ...provider(), providers: [binance, metamask] }), value => { options = value; });
    expect(options.map(option => option.name)).toEqual(["Binance Wallet", "MetaMask"]);
    const single = provider({ isMetaMask: true });
    discoverWalletProviders(browser(single), value => { options = value; });
    expect(options).toMatchObject([{ name: "Injected wallet", source: "LEGACY", provider: single }]);
  });
});
