"use client";

import { useState } from "react";
import { ROUTER_PROVENANCE_EVIDENCE as evidence } from "@/domain/execution/router-provenance";
import type { RouterCheckResult } from "@/lib/proof/router-check";

const explanations: Record<RouterCheckResult["status"], string> = {
  MATCH: "The current runtime bytecode matches the recorded bytes. This does not prove source verification, ownership, or safety.",
  MISMATCH: "The current runtime bytecode differs from the recorded observation. Treat the contract as changed and stop.",
  RPC_UNAVAILABLE: "Canonical BSC reads were unavailable. No match was assumed.",
  NO_CODE: "No runtime bytecode was found at the recorded address.",
  WRONG_CHAIN: "The configured reader returned a chain other than BNB Smart Chain. No result was trusted.",
};

export function RouterRecheck() {
  const [result, setResult] = useState<RouterCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setLoading(true); setError(null); setResult(null);
    try {
      const response = await fetch("/api/proof/router-check", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store",
      });
      const body = await response.json() as RouterCheckResult | { code?: string };
      if (!response.ok || !("status" in body)) throw new Error("code" in body ? body.code : "ROUTER_CHECK_UNAVAILABLE");
      setResult(body);
    } catch {
      setError("RPC check unavailable. No match was assumed. Try again later.");
    } finally { setLoading(false); }
  }

  return <section className="router-recheck" aria-labelledby="router-recheck-title">
    <div><div className="eyebrow">05 / CHECK IT YOURSELF</div><h2 id="router-recheck-title">Recheck router on BNB Chain</h2><p>This user-initiated read performs fixed, read-only RPC calls for chain ID, current block, runtime code and the diamond facet list. It accepts no address input and requires no wallet.</p></div>
    <dl className="router-recorded"><div><dt>Recorded address</dt><dd><code>{evidence.router}</code></dd></div><div><dt>Recorded bytecode hash</dt><dd><code>{evidence.runtimeBytecodeHash}</code></dd></div></dl>
    <button className="primary-button" type="button" onClick={() => void check()} disabled={loading}>{loading ? "Checking BNB Chain…" : "Recheck router on BNB Chain"}<span aria-hidden="true">↗</span></button>
    {!result && !error && <p className="check-empty">No fresh check has run in this browser session.</p>}
    {error && <div className="router-check-result unavailable" role="alert"><strong>RPC_UNAVAILABLE</strong><p>{error}</p></div>}
    {result && <div className={`router-check-result ${result.status.toLowerCase()}`} role="status" aria-live="polite">
      <div><small>RESULT</small><strong>{result.status}</strong></div>
      <p>{explanations[result.status]}</p>
      <dl><div><dt>Observed chain</dt><dd>{result.chainId ?? "Unavailable"}</dd></div><div><dt>Observed block</dt><dd>{result.blockNumber ?? "Unavailable"}</dd></div><div><dt>Check time</dt><dd>{new Date(result.checkedAt).toLocaleString()}</dd></div><div><dt>Freshly computed hash</dt><dd><code>{result.computedHash ?? "Unavailable"}</code></dd></div></dl>
      {result.currentFacets && <details><summary>Current facet addresses ({result.currentFacets.length})</summary><ul>{result.currentFacets.map(facet => <li key={facet}><code>{facet}</code></li>)}</ul><p>Facet addresses are current supporting evidence. They do not establish verified source or ownership.</p></details>}
      <a href={`https://bscscan.com/address/${evidence.router}`} target="_blank" rel="noreferrer">Open address on BscScan ↗</a>
    </div>}
  </section>;
}
