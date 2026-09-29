"use client";

import { useEffect, useState } from "react";

type InjectedProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(name: string, listener: (...args: unknown[]) => void): void;
  removeListener?(name: string, listener: (...args: unknown[]) => void): void;
};
function provider(): InjectedProvider | null {
  return (window as Window & { ethereum?: InjectedProvider }).ethereum ?? null;
}
function short(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

export function WalletAuth() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [status, setStatus] = useState("Connect your BSC wallet for authenticated execution review.");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetch("/api/auth/session", { cache: "no-store" }).then(async response => {
      if (response.ok) {
        const session = await response.json() as { wallet: string | null };
        setWallet(session.wallet);
        if (session.wallet) setStatus("Wallet authenticated. Mainnet execution remains disabled.");
      }
    }).catch(() => setStatus("Authentication state is unavailable."));
    const injected = provider();
    const invalidate = () => {
      setWallet(null);
      setStatus("Wallet or chain changed. Authenticate again before review.");
      window.dispatchEvent(new Event("equityrelay-auth-changed"));
      void fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    };
    injected?.on?.("accountsChanged", invalidate);
    injected?.on?.("chainChanged", invalidate);
    return () => { injected?.removeListener?.("accountsChanged", invalidate); injected?.removeListener?.("chainChanged", invalidate); };
  }, []);
  async function authenticate() {
    const injected = provider();
    if (!injected) { setStatus("Install or open an EVM wallet to continue."); return; }
    setBusy(true);
    try {
      const accounts = await injected.request({ method: "eth_requestAccounts" }) as string[];
      const address = accounts[0];
      const chain = await injected.request({ method: "eth_chainId" }) as string;
      if (!address || chain.toLowerCase() !== "0x38") throw new Error("Switch your wallet to BNB Smart Chain before signing in.");
      const challengeResponse = await fetch("/api/auth/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: address }) });
      if (!challengeResponse.ok) throw new Error("Could not create a wallet authentication challenge.");
      const challenge = await challengeResponse.json() as { message: string };
      const signature = await injected.request({ method: "personal_sign", params: [challenge.message, address] }) as string;
      const response = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: challenge.message, signature }) });
      if (!response.ok) throw new Error("Wallet authentication failed or the challenge expired.");
      const session = await response.json() as { wallet: string };
      setWallet(session.wallet);
      setStatus("Wallet authenticated. Mainnet execution remains disabled.");
      window.dispatchEvent(new Event("equityrelay-auth-changed"));
    } catch (error) { setStatus(error instanceof Error ? error.message : "Wallet authentication unavailable."); }
    finally { setBusy(false); }
  }
  return <section className="wallet-auth" aria-live="polite"><div><span className="eyebrow">CONNECTED WALLET · READ-ONLY REVIEW</span><h2>{wallet ? short(wallet) : "Your wallet, your confirmation"}</h2><p>{status}</p></div>
    <button type="button" className="secondary-button" onClick={() => void authenticate()} disabled={busy}>{busy ? "Checking wallet…" : wallet ? "Reauthenticate" : "Connect wallet"}</button>
    <p className="wallet-auth-note">The sign-in message authenticates your address. Transaction controls remain disabled; no transaction will be signed or submitted.</p></section>;
}
