"use client";
import { useState } from "react";
import type { ReadinessResult } from "@/types/readiness";

const assetOrder = ["BNB", "USDT", "NVDAon", "NVDAB"] as const;
export function ReadinessReview() {
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function check(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/proof/readiness", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Readiness check unavailable");
      setResult(data as ReadinessResult);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Readiness check unavailable"); }
    finally { setLoading(false); }
  }
  return <div className="readiness-layout">
    <section className="readiness-intro"><span className="eyebrow">READ-ONLY / NO FUNDS MOVED</span><h1>Prepare the smallest meaningful proof.</h1><p>This local test checks one BSC wallet, tries small NVIDIA route sizes, and estimates the assets and gas that a later mainnet proof would require.</p>
      <form onSubmit={check}><label className="field-label" htmlFor="readiness-address">BSC wallet address to inspect</label><input className="address-input" id="readiness-address" value={address} onChange={event => setAddress(event.target.value)} placeholder="0x…" required /><p className="field-hint">Balances stay on this local screen. This check makes read-only API requests and cannot move funds.</p><button className="primary-button" disabled={loading} type="submit">{loading ? "Checking live evidence…" : "Check proof readiness"}<span>↗</span></button></form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
    <section className="readiness-results" aria-live="polite">
      {!result && <div className="readiness-empty"><span className="eyebrow">MAINNET PROOF READINESS</span><h2>Start from the wallet you would use.</h2><p>We will identify its relevant assets, test route sizes in order, and show a technical reserve estimate when live gas evidence is available.</p></div>}
      {result?.kind === "unavailable" && <div><span className="status-pill block">UNAVAILABLE</span><h2>Live readiness could not be established.</h2><p>{result.reason}</p></div>}
      {result?.kind === "readiness" && <div><div className="result-top"><div><span className="eyebrow">MAINNET PROOF READINESS</span><h2>{result.wallet.walletShort}</h2></div><span className="status-pill block">READ-ONLY</span></div>
        <p className="readiness-note">NO FUNDS MOVED · Nothing has been signed or submitted.</p>
        <h3>Current wallet</h3><div className="readiness-balances">{assetOrder.map(asset => <div key={asset}><span>{asset}</span><strong>{result.wallet.assets[asset].balance}</strong><small>{result.wallet.assets[asset].reported ? "Live balance" : "Not returned · treated as zero"}</small></div>)}</div>
        <h3>Smallest route tested</h3><p className="readiness-feature">{result.smallestViable ? `${result.smallestViable.amount} NVDAon` : "No viable candidate yet"}</p><p className="readiness-note">NVDAon → USDT → NVDAB → Venus · Exposure reduction limit 0.50%</p>
        <div className="readiness-candidates">{result.candidates.map(item => <div key={item.amount}><strong>{item.amount} NVDAon</strong><span>{item.status.replaceAll("_", " ")}</span><small>{item.retentionPercent ? `${item.retentionPercent}% NVIDIA exposure retained` : item.reason ?? "No result"}</small></div>)}</div>
        <h3>Separate test setup</h3><p>{result.acquisition.required ? "Source acquisition would be required before the EquityRelay demo." : "No source acquisition identified."} {result.acquisition.note}</p>{result.acquisition.usdtInput && <p className="readiness-feature">{result.acquisition.usdtInput} USDT <span>→ quoted {result.acquisition.quotedNvdaonOutput} NVDAon</span></p>}
        <h3>Estimated gas</h3><p>{result.gas.proofGasUnits ?? `${result.gas.knownProofGasUnits} known; total unavailable`} proof gas units · {result.gas.estimatedProofCostBNB ?? `${result.gas.knownProofCostBNB ?? "Unknown"} known subtotal`} BNB estimated cost</p><p><strong>{result.gas.complete ? "Recommended buffer:" : "Provisional technical cushion:"}</strong> {result.gas.recommendedTotalGasReserveBNB ?? result.gas.provisionalTechnicalReserveBNB ?? "Unavailable"} BNB {result.gas.complete ? "(2× estimated total including setup)" : "(10× known fee subtotal or 0.002 BNB, whichever is larger; deposit gas remains unestimated)"}</p>
        {result.gas.missing.length > 0 && <p className="readiness-note">Missing: {result.gas.missing.join(" · ")}</p>}
        <h3>Technical requirements</h3><div className="readiness-requirements">{result.requirements.map(item => <div key={item.asset}><b>{item.asset}</b><span>Required {item.requiredBalance}</span><strong>Gap {item.gap}</strong></div>)}</div>
        <h3>Remaining blockers</h3><ul>{result.blockers.map(item => <li key={item}>{item}</li>)}</ul><p className="readiness-note">Indicative quotes, gas prices and wallet balances can change. This report is a software validation plan, not an investment recommendation.</p>
      </div>}
    </section>
  </div>;
}
