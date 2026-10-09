import type { Metadata } from "next";
import Link from "next/link";
import { RouterRecheck } from "@/components/proof/router-recheck";
import { SiteHeader } from "@/components/shared/site-header";
import { ROUTER_PROVENANCE_EVIDENCE as evidence } from "@/domain/execution/router-provenance";

export const metadata: Metadata = {
  title: "Execution safety proof | EquityRelay",
  description: "The recorded operator refusal after an exact approval review exposed insufficient deployed-contract provenance.",
};

const safetySequence = [
  ["01", "Binance quote", "Authenticated API responses named LiquidMesh and returned a route."],
  ["02", "Bounded review", "The guarded UI opened an exact USDT approval review in Binance Wallet."],
  ["03", "Wallet warning", "The wallet classified the unverified authorization target as high risk."],
  ["04", "User cancelled", "The operator cancelled. Nothing was signed, broadcast, or confirmed onchain."],
  ["05", "Provenance review", "Later research found API provenance but insufficient deployed-contract attribution."],
  ["06", "Recorded refusal", "The operator decision was recorded. It is not currently an automatic action-delivery gate."],
] as const;

export default function ExecutionSafetyProofPage() {
  return <>
    <SiteHeader inApp />
    <main className="wrap proof-main execution-safety-proof">
      <div className="proof-stamps"><span>EXECUTION SAFETY PROOF</span><span>API_PROVENANCE_ONLY</span><span>NO APPROVAL · NO SIGNATURE · NO BROADCAST</span></div>
      <h1>A valid route was not<br />enough to proceed.</h1>
      <p className="proof-lead">A guarded approval review reached Binance Wallet. The wallet warned that the authorization target was high risk and unverified, and the user cancelled it. A later provenance investigation found authenticated API provenance but insufficient deployed-contract attribution and recorded an operator refusal.</p>

      <div className="proof-summary refusal-summary">
        <div><small>CLASSIFICATION</small><strong>{evidence.classification}</strong></div><span>·</span>
        <div><small>OPERATOR DECISION</small><strong>EXECUTION REFUSED</strong></div><span>·</span>
        <div><small>ENFORCEMENT</small><strong>RECORDED · NOT RUNTIME GATED</strong></div>
      </div>

      <section className="proof-section">
        <div className="eyebrow">01 / TWO DIFFERENT PROVENANCE QUESTIONS</div>
        <h2>Authenticated response does not verify deployed code.</h2>
        <div className="provenance-split">
          <article><span>AUTHENTICATED API PROVENANCE</span><strong>Established</strong><p>Three authenticated Binance Web3 API build responses named <b>LiquidMesh</b> and returned the same address as both swap target and approval spender.</p></article>
          <article className="refused"><span>DEPLOYED CONTRACT PROVENANCE</span><strong>Not established</strong><p>BscScan source and the detected diamond facets were unverified. No Binance or LiquidMesh deployment registry or deployment-specific audit naming this address was found.</p></article>
        </div>
      </section>

      <section className="proof-section">
        <div className="eyebrow">02 / RECORDED BUILD EVIDENCE · {evidence.observedAt.slice(0, 10)}</div>
        <h2>Three routes returned one authorization target.</h2>
        <p className="proof-code">Target and spender: <a href={`https://bscscan.com/address/${evidence.router}`} target="_blank" rel="noreferrer"><code>{evidence.router}</code></a></p>
        <div className="proof-table router-build-table">
          <div><span>Route</span><span>Provider / mode</span><span>Exact proposed approval</span></div>
          {evidence.builds.map(build => <div key={build.quoteId}><strong>{build.route}</strong><strong>{build.provider} · {build.executionMode}</strong><strong>{build.approvalAmount}</strong></div>)}
        </div>
        <p>Each proposed allowance was exact and bounded to its route input. The first approval review was opened in Binance Wallet and then cancelled by the user. No approval transaction was signed or broadcast, and no allowance was confirmed onchain.</p>
      </section>

      <section className="proof-section">
        <div className="eyebrow">03 / RECORDED ONCHAIN IDENTITY</div>
        <h2>The address was an upgradeable diamond.</h2>
        <div className="proof-evidence-columns">
          <section><h2>Observed on 2026-10-08</h2><p>Chain: BNB Smart Chain · 56</p><p>Architecture: ERC-2535 diamond</p><p>Runtime bytecode hash:</p><p><code>{evidence.runtimeBytecodeHash}</code></p></section>
          <section><h2>Missing attribution</h2><p>BscScan verified source: No</p><p>Verified active facets: No</p><p>Published deployment registry: Not found</p><p>Deployment-specific audit: Not found</p></section>
        </div>
      </section>

      <section className="proof-section">
        <div className="eyebrow">04 / REVIEW SEQUENCE</div><h2>The review stopped before any onchain action.</h2>
        <div className="safety-sequence" aria-label="Execution safety review sequence">{safetySequence.map(([number,title,description],index) => <div key={number}><span>{number}</span><strong>{title}</strong><p>{description}</p>{index < safetySequence.length - 1 && <i aria-hidden="true">→</i>}</div>)}</div>
      </section>

      <RouterRecheck />

      <section className="proof-section refusal-decision">
        <div className="eyebrow">06 / RECORDED DECISION</div><h2>The operator refused execution.</h2>
        <p>Binance Wallet&apos;s high-risk, unverified-contract warning preceded the user&apos;s cancellation. The subsequent investigation documented the missing deployed-code provenance. The current action-delivery code does not automatically call this provenance decision; production remains disarmed, and the refusal is an explicit security and operator record.</p>
        <strong>{evidence.decision}</strong>
      </section>

      <div className="proof-end"><div><strong>What this record proves</strong><p>The team distinguished an authenticated API route from independently defensible contract provenance and refused to proceed. It does not claim an automatic runtime provenance gate or a completed EquityRelay transaction.</p></div><Link href="/proof/venus-verifier" className="primary-button">See canonical Venus proof <span>↗</span></Link></div>
    </main>
  </>;
}
