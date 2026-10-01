"use client";

import { useState } from "react";
import Decimal from "decimal.js";
import type { Address, BrowserIntent, PreviewResult, RouteDecision } from "@/types/route";
import type { PreflightResult } from "@/types/preflight";
import { PreflightReview } from "./preflight-review";
import type { SupportedUnderlying } from "@/domain/equities/registry";

const assets: Array<{ underlying: SupportedUnderlying; name: string; symbol: string; icon: string; execution: "VALIDATED" | "NOT_VALIDATED" }> = [
  { underlying: "NVDA", name: "NVIDIA", symbol: "NVDA", icon: "N", execution: "VALIDATED" },
  { underlying: "TSLA", name: "Tesla", symbol: "TSLA", icon: "T", execution: "NOT_VALIDATED" },
  { underlying: "SPCX", name: "SPCX", symbol: "SPCX", icon: "S", execution: "NOT_VALIDATED" },
];

const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const percentPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

function displayDecimal(value: string, places: number): string {
  return new Decimal(value).toFixed(places, Decimal.ROUND_HALF_UP);
}

function RouteEvidence({ decision }: { decision: RouteDecision }) {
  const { evidence } = decision;
  return <details className="evidence-disclosure">
    <summary>Why this route? <span>View issuer, quote and destination evidence</span></summary>
    <div className="evidence-grid">
      <div><small>Current representation</small><strong>{evidence.source.symbol} · Ondo</strong><code>{evidence.source.address}</code><small>Share ratio {evidence.source.tokenToShareRatio}</small></div>
      <div><small>Destination representation</small><strong>{evidence.target.symbol} · bStocks</strong><code>{evidence.target.address}</code><small>Share ratio {evidence.target.tokenToShareRatio}</small></div>
      <div><small>Settlement rail</small><strong>USDT on BNB Chain</strong><code>{evidence.leg1.to}</code><small>Two sequential indicative quotes</small></div>
      <div><small>Destination</small><strong>Venus · {evidence.destination.investable ? "Investable" : "Unavailable"}</strong><code>{evidence.destination.investmentId}</code><small>Observed {new Date(evidence.destination.observedAt).toLocaleString()}</small></div>
    </div>
    <p className="evidence-note">Quotes are read-only and may change. Quote identifiers, signing headers and credentials are not shown. {decision.expiresAt ? `Earliest reported expiry: ${new Date(decision.expiresAt).toLocaleString()}.` : "Binance did not provide a reliable quote expiry; treat this as a short-lived preview."}</p>
  </details>;
}

function Result({ result, onPreflight, preflightLoading }: { result: PreviewResult; onPreflight: () => void; preflightLoading: boolean }) {
  if (result.kind !== "decision") return <section className={`result-panel ${result.state === "UNAVAILABLE" ? "unavailable" : "blocked"}`} role="status" aria-live="polite">
    <div className="eyebrow">ROUTE PREVIEW</div><h2>{result.state}</h2><p>{result.message}</p><span className="reason">{result.reasons.join(" · ")}</span>
  </section>;
  const pass = result.state === "PASS";
  return <section className={`result-panel ${pass ? "passed" : "blocked"}`} aria-live="polite">
    <div className="result-top"><div><div className="eyebrow">ROUTE READY · READ-ONLY PREVIEW</div><h2>{result.displayName} <span>→</span> Venus</h2></div><div className="verdict-stack"><strong className={`status-pill ${pass ? "pass" : "block"}`}>{result.state}</strong>{pass && <small>Inside your {displayDecimal(new Decimal(result.maxExposureLossBps).div(100).toString(), 2)}% limit</small>}</div></div>
    <div className="capability-line"><span><small>ROUTE STATUS</small><strong>{pass ? "Route available" : "Route blocked"}</strong></span><span className={result.executionVerifierStatus === "VALIDATED" ? "verified" : "pending"}><small>EXECUTION VERIFICATION</small><strong>{result.executionVerifierStatus === "VALIDATED" ? "Verified" : "Pending · preview only"}</strong></span></div>
    <div className="route-line" aria-label="Compiled route"><span><small>Current</small>Ondo</span><i aria-hidden="true">→</i><span><small>Settlement</small>USDT</span><i aria-hidden="true">→</i><span><small>Compatible</small>bStocks</span><i aria-hidden="true">→</i><span><small>Destination</small>Venus</span></div>
    <div className="exposure-grid">
      <div><small>BEFORE · {result.underlying}-EQUIVALENT SHARES</small><strong>{displayDecimal(result.sourceShares, 8)}</strong></div>
      <div><small>PROJECTED AFTER CONVERSION</small><strong>{displayDecimal(result.targetShares, 8)}</strong></div>
      <div className="retention"><small>PROJECTED EXPOSURE RETAINED</small><strong>{displayDecimal(result.retentionPercent, 4)}%</strong></div>
      <div><small>YOUR MINIMUM RETENTION</small><strong>{displayDecimal(new Decimal(100).minus(new Decimal(result.maxExposureLossBps).div(100)).toString(), 2)}%</strong></div>
    </div>
    <p className="result-message">{pass ? "This indicative route is inside your exposure limit. Nothing has been signed or submitted." : "This route does not meet your exposure limit or destination checks. Nothing has been signed or submitted."}</p>
    <div className="result-meta"><span>{result.reasons.join(" · ")}</span><span>Observed {new Date(result.observedAt).toLocaleTimeString()}</span></div>
    {pass && <button className="primary-button preflight-button" type="button" onClick={onPreflight} disabled={preflightLoading}>{preflightLoading ? "Checking transaction plan…" : "Preflight route"}<span aria-hidden="true">↗</span></button>}
    <RouteEvidence decision={result} />
  </section>;
}

export function RoutePreviewForm() {
  const [underlying, setUnderlying] = useState<SupportedUnderlying>("NVDA");
  const [amount, setAmount] = useState("0.25");
  const [address, setAddress] = useState("");
  const [maxLoss, setMaxLoss] = useState("0.50");
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [lastIntent, setLastIntent] = useState<BrowserIntent | null>(null);
  const selectedAsset = assets.find(asset => asset.underlying === underlying)!;

  function invalidate() { setResult(null); setPreflight(null); setLastIntent(null); }

  async function requestPreflight() {
    if (!lastIntent || result?.kind !== "decision" || result.state !== "PASS") return;
    setPreflight(null); setPreflightLoading(true);
    try {
      const response = await fetch("/api/route/preflight", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(lastIntent) });
      if (!response.ok) throw new Error("Preflight request failed.");
      setPreflight(await response.json() as PreflightResult);
    } catch { setPreflight({ kind: "refusal", routePolicy: "UNAVAILABLE", overallPreflightState: "UNAVAILABLE", reason: "Preflight service is unavailable. No transaction plan was assumed." }); }
    finally { setPreflightLoading(false); setTimeout(() => document.getElementById("preflight-review")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); invalidate();
    if (!addressPattern.test(address)) { setError("Enter a valid BSC wallet address for a live quote."); return; }
    if (!percentPattern.test(maxLoss)) { setError("Enter a maximum exposure reduction with up to two decimal places."); return; }
    let bps: number;
    try { bps = new Decimal(maxLoss).mul(100).toNumber(); if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error(); }
    catch { setError("Enter a maximum exposure reduction between 0% and 100%."); return; }
    setLoading(true);
    const intent: BrowserIntent = { underlying, sourceRepresentation: "ondo", amount, destination: "venus", maxExposureLossBps: bps, takerAddress: address as Address };
    try {
      const response = await fetch("/api/route/preview", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify(intent),
      });
      const body = await response.json();
      if (!response.ok) { setError(body.message ?? "Check your route details and try again."); return; }
      setResult(body as PreviewResult);
      setLastIntent(intent);
    } catch { setResult({ kind: "unavailable", state: "UNAVAILABLE", reasons: ["UNAVAILABLE_API"], message: "The route service is unavailable. No result was assumed." }); }
    finally { setLoading(false); }
  }

  return <><div className="app-grid">
    <form className="route-form" onSubmit={submit}>
      <div className="form-intro"><div className="eyebrow">BUILD A ROUTE · BNB CHAIN</div><h1>Where should your asset go?</h1><p>Choose a supported tokenized equity asset. We’ll find the representation Venus accepts and check the conversion against your limit.</p></div>
      <div className="step-label"><span>01</span>Choose an asset</div>
      <div className="asset-selector" role="radiogroup" aria-label="Supported asset">
        {assets.map(asset => <button key={asset.underlying} type="button" role="radio" aria-checked={underlying === asset.underlying} className={underlying === asset.underlying ? "selected" : ""} onClick={() => { setUnderlying(asset.underlying); invalidate(); }}>
          <span className="asset-icon">{asset.icon}</span><span><strong>{asset.name}</strong><small>{asset.symbol} · {asset.execution === "VALIDATED" ? "execution verified" : "preview only"}</small></span>
        </button>)}
      </div>
      <div className="holding"><div className="stock-icon">{selectedAsset.icon}</div><div><strong>{selectedAsset.name}</strong><small>Current representation · Ondo</small></div><span className="holding-tag">BNB Chain</span></div>
      <label className="field-label" htmlFor="stock-amount">Amount of your current {selectedAsset.symbol} representation</label>
      <div className="input-shell"><input id="stock-amount" type="text" inputMode="decimal" required value={amount} onChange={e => { setAmount(e.target.value); invalidate(); }} aria-describedby="amount-hint" /><span>tokens</span></div>
      <small className="field-hint" id="amount-hint">Enter a human-readable amount. A balance is not required for a read-only quote.</small>
      <div className="step-label"><span>02</span>Your destination</div>
      <div className="destination-choice"><div className="destination-symbol">V</div><div><strong>Use as collateral</strong><small>Venus · compatible {selectedAsset.symbol} rail</small></div><span className="choice-check" aria-label="Selected">✓</span></div>
      <div className="step-label"><span>03</span>Your safety limit</div>
      <label className="field-label" htmlFor="max-loss">Maximum exposure reduction</label>
      <div className="input-shell percent"><input id="max-loss" type="text" inputMode="decimal" required value={maxLoss} onChange={e => { setMaxLoss(e.target.value); invalidate(); }} /><span>%</span></div>
      <small className="field-hint">The route is blocked if projected {selectedAsset.symbol}-equivalent exposure reduction exceeds this limit.</small>
      <label className="field-label address-label" htmlFor="taker-address">Wallet address for live quote</label>
      <input className="address-input" id="taker-address" type="text" placeholder="0x…" required value={address} onChange={e => { setAddress(e.target.value.trim()); invalidate(); }} autoComplete="off" spellCheck={false} />
      <small className="field-hint">Used only for address-specific RWA pricing. Entering an address does not connect or sign. Any later execution review is bound to the separately authenticated wallet.</small>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button build-button" type="submit" disabled={loading}>{loading ? "Discovering route…" : "Build route"}<span aria-hidden="true">↗</span></button>
      <p className="form-footnote">Read-only preview · No approvals, signatures, swaps or deposits</p>
    </form>
    <div className="preview-column">
      {loading ? <section className="preview-placeholder loading" role="status"><div className="eyebrow">DISCOVERING</div><div className="pulse-line" /><h2>Finding the right rail</h2><p>Checking live stock representations, two route quotes and Venus availability.</p><div className="skeleton" /><div className="skeleton short" /></section>
        : result ? <Result result={result} onPreflight={requestPreflight} preflightLoading={preflightLoading} />
        : <section className="preview-placeholder"><div className="eyebrow">YOUR ROUTE, EXPLAINED</div><div className="diagram-circle">{selectedAsset.icon}<span>→</span>V</div><h2>One asset.<br />The right destination.</h2><p>Your route preview will compare {selectedAsset.symbol}-equivalent exposure before and after the conversion, then show a clear PASS or BLOCKED result.</p><div className="placeholder-bottom"><span>01 <b>Discover</b></span><span>02 <b>Normalize</b></span><span>03 <b>Decide</b></span></div></section>}
    </div>
  </div>{preflightLoading && <section className="preflight-loading" role="status"><div className="eyebrow">READ-ONLY PREFLIGHT</div><h2>Checking the exact transaction plan</h2><p>Refreshing quotes, building unsigned actions and asking Binance to simulate where supported.</p></section>}{preflight && <PreflightReview result={preflight} />}</>;
}
