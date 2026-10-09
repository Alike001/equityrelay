"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Availability = "AVAILABLE" | "UNAVAILABLE" | "NOT_CHECKED" | "STALE";
type Health = {
  status: string; canonicalRpcStatus?: string; chainId?: number; minConfirmations?: number;
  requireFinalized?: boolean; finalizedBlock?: string | null; executionArmed?: boolean;
  deprecatedRelayLocked?: boolean; boundedLogCount?: number; code?: string;
};

export function checkedAvailability(checkedAt: number | null, healthy: boolean, now = Date.now()): Availability {
  if (checkedAt === null) return "NOT_CHECKED";
  if (!healthy) return "UNAVAILABLE";
  return now - checkedAt > 120_000 ? "STALE" : "AVAILABLE";
}

function State({ value }: { value: Availability }) { return <span className={`public-state ${value.toLowerCase()}`}>{value.replace("_", " ")}</span>; }

export function SystemStatus({ configuredExecutionArmed, configuredConfirmations, configuredFinalized }: {
  configuredExecutionArmed: boolean; configuredConfirmations: number; configuredFinalized: boolean;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const healthy = health?.canonicalRpcStatus === "READY" && health.chainId === 56;
  const current = checkedAvailability(checkedAt, healthy, now);

  async function check() {
    setChecking(true);
    try {
      const response = await fetch("/api/health/execution-readiness", { cache: "no-store" });
      setHealth(await response.json() as Health);
    } catch { setHealth({ status: "BLOCKED", code: "STATUS_UNAVAILABLE" }); }
    finally { const observedAt = Date.now(); setCheckedAt(observedAt); setNow(observedAt); setChecking(false); }
  }

  return <>
    <section className="status-check-panel">
      <div><div className="eyebrow">USER-INITIATED HEALTH CHECK</div><h2>Current canonical infrastructure</h2><p>No RPC probe runs merely because this page opened. Check now to query the sanitized production readiness endpoint.</p></div>
      <button className="primary-button" type="button" onClick={() => void check()} disabled={checking}>{checking ? "Checking…" : "Check system now"}<span aria-hidden="true">↗</span></button>
    </section>
    <div className="status-grid">
      <article><div><span>Canonical BSC RPC</span><State value={current} /></div><strong>{health?.canonicalRpcStatus ?? "Not checked"}</strong><p>{health?.chainId ? `Observed chain ${health.chainId}` : "Expected chain 56; click Check system now for a fresh observation."}</p></article>
      <article><div><span>Finality policy</span><State value={current} /></div><strong>{health ? `${health.minConfirmations} confirmations + ${health.requireFinalized ? "finalized" : "no finalized requirement"}` : `${configuredConfirmations} confirmations + ${configuredFinalized ? "finalized" : "configured policy"}`}</strong><p>{health?.finalizedBlock ? `Latest observed finalized block ${health.finalizedBlock}.` : "Policy configuration shown; current block not checked yet."}</p></article>
      <article><div><span>Execution environment</span><State value="AVAILABLE" /></div><strong>{(health?.executionArmed ?? configuredExecutionArmed) ? "ARMED" : "DISARMED"}</strong><p>Environment state is factual. Every route and authorization gate remains separate.</p></article>
      <article><div><span>Deprecated relay</span><State value="AVAILABLE" /></div><strong>{health?.deprecatedRelayLocked === false ? "Unexpectedly open" : "Permanently locked"}</strong><p>The legacy backend relay is not the connected-wallet path.</p></article>
      <article><div><span>Binance Web3 API</span><State value="NOT_CHECKED" /></div><strong>Not checked on this page</strong><p>Open the live route builder for a genuine current RWA, Trading and DeFi result.</p><Link href="/app">Build a live route ↗</Link></article>
      <article><div><span>Venus verifier</span><State value="AVAILABLE" /></div><strong>Historical canonical evidence</strong><p>Supply and redemption verifier profiles are backed by labeled historical transactions. They are not EquityRelay executions.</p><Link href="/proof/venus-verifier">Inspect evidence ↗</Link></article>
      <article><div><span>Router provenance</span><State value="AVAILABLE" /></div><strong>API_PROVENANCE_ONLY</strong><p>Recorded operator refusal. The provenance decision is not currently called by action delivery.</p><Link href="/proof/execution-safety">Inspect refusal ↗</Link></article>
      <article><div><span>Last system check</span><State value={current} /></div><strong>{checkedAt ? new Date(checkedAt).toLocaleString() : "Not checked"}</strong><p>{health?.code ? `Reason: ${health.code}` : health ? `Readiness: ${health.status}` : "No monitoring history or uptime claim is inferred."}</p></article>
    </div>
    <section className="asset-status-section"><div className="eyebrow">ASSET ROUTE AVAILABILITY</div><h2>Checked only when you ask.</h2><p>This status page does not spend three live quote sequences on every anonymous visit.</p><div className="asset-status-list">{["NVIDIA","SPCX","Tesla"].map(asset => <div key={asset}><strong>{asset}</strong><State value="NOT_CHECKED" /><span>Use the route builder for a fresh result.</span></div>)}</div></section>
  </>;
}
