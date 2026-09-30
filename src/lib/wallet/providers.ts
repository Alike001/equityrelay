export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(name: string, listener: (...args: unknown[]) => void): void;
  removeListener?(name: string, listener: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
  isBinance?: boolean;
  isBinanceChain?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
};

export type Eip6963ProviderInfo = { uuid: string; name: string; icon: string; rdns: string };
export type Eip6963ProviderDetail = { info: Eip6963ProviderInfo; provider: Eip1193Provider };
export type WalletProviderOption = Eip6963ProviderInfo & {
  id: string;
  source: "EIP6963" | "LEGACY";
  provider: Eip1193Provider;
};
export type ProviderSelection = { id: string; uuid: string | null; rdns: string | null; source: WalletProviderOption["source"] };

type BrowserWindow = Window & { ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] } };
export const providerSelectionKey = "equityrelay.selected-wallet-provider.v1";

function legacyName(provider: Eip1193Provider, index: number, total: number): string {
  if (total === 1) return "Injected wallet";
  if (provider.isBinance || provider.isBinanceChain) return "Binance Wallet";
  if (provider.isMetaMask) return "MetaMask";
  if (provider.isTrust || provider.isTrustWallet) return "Trust Wallet";
  return `Other injected wallet ${index + 1}`;
}

function legacyProviders(browser: BrowserWindow): Eip1193Provider[] {
  const injected = browser.ethereum;
  if (!injected) return [];
  const candidates = Array.isArray(injected.providers) && injected.providers.length ? injected.providers : [injected];
  return candidates.filter((provider, index) => !!provider?.request && candidates.indexOf(provider) === index);
}

export function providerSelection(option: WalletProviderOption): ProviderSelection {
  return { id: option.id, uuid: option.source === "EIP6963" ? option.uuid : null,
    rdns: option.source === "EIP6963" ? option.rdns : null, source: option.source };
}

export function restoreSelectedProvider(options: WalletProviderOption[], selection: ProviderSelection | null): WalletProviderOption | null {
  if (!selection) return null;
  const byId = options.filter(option => option.id === selection.id);
  if (byId.length === 1) return byId[0];
  if (selection.uuid) {
    const byUuid = options.filter(option => option.uuid === selection.uuid);
    if (byUuid.length === 1) return byUuid[0];
  }
  if (selection.rdns) {
    const byRdns = options.filter(option => option.rdns === selection.rdns);
    if (byRdns.length === 1) return byRdns[0];
  }
  return null;
}

export function readProviderSelection(storage: Pick<Storage, "getItem">): ProviderSelection | null {
  try {
    const value = JSON.parse(storage.getItem(providerSelectionKey) ?? "null") as Partial<ProviderSelection> | null;
    return value && typeof value.id === "string" && (value.source === "EIP6963" || value.source === "LEGACY") ?
      { id: value.id, uuid: typeof value.uuid === "string" ? value.uuid : null,
        rdns: typeof value.rdns === "string" ? value.rdns : null, source: value.source } : null;
  } catch { return null; }
}

export function discoverWalletProviders(browser: BrowserWindow, onChange: (options: WalletProviderOption[]) => void): () => void {
  let options: WalletProviderOption[] = [];
  const publish = () => onChange([...options]);
  const announce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
    if (!detail?.provider?.request || !detail.info || !detail.info.uuid || !detail.info.name || !detail.info.rdns) return;
    const existing = options.findIndex(option => option.provider === detail.provider || option.id === `eip6963:${detail.info.uuid}`);
    const next: WalletProviderOption = { ...detail.info, id: `eip6963:${detail.info.uuid}`, source: "EIP6963", provider: detail.provider };
    if (existing >= 0) options[existing] = next;
    else options.push(next);
    options = options.filter((option, index, all) => option.source === "EIP6963" ||
      !all.some(candidate => candidate.source === "EIP6963" && candidate.provider === option.provider) &&
      all.findIndex(candidate => candidate.provider === option.provider) === index);
    publish();
  };
  browser.addEventListener("eip6963:announceProvider", announce as EventListener);
  browser.dispatchEvent(new Event("eip6963:requestProvider"));
  const legacy = legacyProviders(browser);
  for (const [index, provider] of legacy.entries()) {
    if (options.some(option => option.provider === provider)) continue;
    options.push({ id: `legacy:${index}`, uuid: `legacy-${index}`, name: legacyName(provider, index, legacy.length),
      icon: "", rdns: "", source: "LEGACY", provider });
  }
  publish();
  return () => browser.removeEventListener("eip6963:announceProvider", announce as EventListener);
}
