"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authenticateSelectedProvider, logoutEquityRelay, requestBscSwitch, validateSelectedProviderSession } from "@/lib/wallet/auth";
import { discoverWalletProviders, providerSelection, providerSelectionKey, readProviderSelection, restoreSelectedProvider,
  type WalletProviderOption } from "@/lib/wallet/providers";

function short(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function announceAuthChange() { window.dispatchEvent(new Event("equityrelay-auth-changed")); }

export function WalletAuth() {
  const [providers, setProviders] = useState<WalletProviderOption[]>([]);
  const [discoveryReady, setDiscoveryReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [status, setStatus] = useState("Discovering EVM wallets…");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wrongChain, setWrongChain] = useState(false);
  const restored = useRef(false);
  const selected = useMemo(() => providers.find(option => option.id === selectedId) ?? null, [providers, selectedId]);

  const clearLocalAuth = useCallback((message: string, clearProvider = true) => {
    setWallet(null);
    setWrongChain(false);
    setPickerOpen(false);
    if (clearProvider) {
      localStorage.removeItem(providerSelectionKey);
      setSelectedId(null);
    }
    setStatus(message);
    announceAuthChange();
  }, []);

  const logout = useCallback(async (message: string, clearProvider = true) => {
    try { await logoutEquityRelay(fetch); }
    finally { clearLocalAuth(message, clearProvider); }
  }, [clearLocalAuth]);

  useEffect(() => {
    const stop = discoverWalletProviders(window, setProviders);
    const timer = window.setTimeout(() => setDiscoveryReady(true), 150);
    return () => { window.clearTimeout(timer); stop(); };
  }, []);

  useEffect(() => {
    if (!discoveryReady || restored.current) return;
    restored.current = true;
    const selection = readProviderSelection(localStorage);
    const savedProvider = restoreSelectedProvider(providers, selection);
    void fetch("/api/auth/session", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("SESSION_UNAVAILABLE");
      if (savedProvider) setSelectedId(savedProvider.id);
      const session = await response.json() as { wallet: string | null };
      if (!session.wallet) {
        setStatus(providers.length ? "Connect your BSC wallet for authenticated execution review." : "No EVM wallet detected");
        return;
      }
      if (!savedProvider || !await validateSelectedProviderSession(savedProvider.provider, session.wallet)) {
        await logout("Wallet selection, account, or chain no longer matches. Authenticate again.");
        return;
      }
      setWallet(session.wallet);
      setStatus("Wallet authenticated. Mainnet execution remains disabled.");
    }).catch(() => setStatus("Authentication state is unavailable."));
  }, [discoveryReady, logout, providers]);

  useEffect(() => {
    if (!selected) return;
    const invalidate = () => { void logout("Wallet or chain changed. Authenticate again before review."); };
    selected.provider.on?.("accountsChanged", invalidate);
    selected.provider.on?.("chainChanged", invalidate);
    return () => {
      selected.provider.removeListener?.("accountsChanged", invalidate);
      selected.provider.removeListener?.("chainChanged", invalidate);
    };
  }, [logout, selected]);

  async function authenticate(option: WalletProviderOption) {
    setBusy(true);
    setPickerOpen(false);
    setWrongChain(false);
    setSelectedId(option.id);
    localStorage.setItem(providerSelectionKey, JSON.stringify(providerSelection(option)));
    try {
      const authenticated = await authenticateSelectedProvider(option.provider, fetch);
      setWallet(authenticated);
      setStatus("Wallet authenticated. Mainnet execution remains disabled.");
      announceAuthChange();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet authentication unavailable.";
      setWrongChain(message === "Switch to BNB Smart Chain to continue.");
      setStatus(message);
    } finally { setBusy(false); }
  }

  function connect() {
    if (!providers.length) { setStatus("No EVM wallet detected"); return; }
    if (selected) { void authenticate(selected); return; }
    if (providers.length === 1) { void authenticate(providers[0]); return; }
    setPickerOpen(true);
    setStatus("Choose the wallet you want EquityRelay to use.");
  }

  async function switchToBsc() {
    if (!selected) return;
    setBusy(true);
    try {
      await requestBscSwitch(selected.provider);
      setWrongChain(false);
      setStatus("BNB Smart Chain selected. Continue with wallet authentication.");
    } catch { setStatus("Switch to BNB Smart Chain to continue. You can switch manually in your wallet."); }
    finally { setBusy(false); }
  }

  return <section className="wallet-auth" aria-live="polite"><div><span className="eyebrow">CONNECTED WALLET · READ-ONLY REVIEW</span>
    <h2>{wallet ? short(wallet) : "Your wallet, your confirmation"}</h2><p>{status}</p></div>
    <div className="wallet-auth-actions">
      <button type="button" className="secondary-button" onClick={connect} disabled={busy || !discoveryReady}>{busy ? "Checking wallet…" : wallet ? "Reauthenticate" : "Connect wallet"}</button>
      {wrongChain && selected && <button type="button" className="secondary-button" onClick={() => void switchToBsc()} disabled={busy}>Switch network</button>}
      {wallet && <button type="button" className="wallet-disconnect" onClick={() => void logout("Disconnected from EquityRelay. Your wallet may still remember this site.")} disabled={busy}>Disconnect</button>}
    </div>
    {pickerOpen && providers.length > 1 && <div className="wallet-picker" role="dialog" aria-label="Choose an EVM wallet"><strong>Choose wallet</strong>
      <div>{providers.map(option => <button type="button" key={option.id} onClick={() => void authenticate(option)} disabled={busy}>
        {option.icon && /^(data:image\/|https:\/\/)/.test(option.icon) ?
          // EIP-6963 wallet icons are runtime provider metadata and cannot use a build-time Next image allowlist.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={option.icon} alt="" width="24" height="24" /> : <span className="wallet-icon-fallback" aria-hidden="true">◈</span>}
        <span>{option.name}</span></button>)}</div></div>}
    <p className="wallet-auth-note">The sign-in message authenticates your address. No transaction, approval, or gas is involved. Disconnect revokes the EquityRelay session; wallet site permission is managed in your extension.</p>
  </section>;
}
