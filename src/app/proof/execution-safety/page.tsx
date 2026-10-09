import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/shared/site-header";
import { ROUTER_PROVENANCE_EVIDENCE as evidence } from "@/domain/execution/router-provenance";

export const metadata: Metadata = {
  title: "Execution safety proof | EquityRelay",
  description:
    "Why EquityRelay refused an exact token approval after authenticated route construction exposed insufficient deployed-contract provenance.",
};

const safetySequence = [
  ["01", "Binance quote", "Authenticated API response named LiquidMesh and returned an executable route."],
  ["02", "Bounded approval", "The requested allowance was reduced to the exact route input."],
  ["03", "Provenance check", "The target was an unverified, upgradeable ERC-2535 diamond with unverified facets."],
  ["04", "Wallet warning", "Binance Wallet classified approval to the contract as high risk and unverified."],
  ["05", "Fail closed", "No published deployment registry or matching audit was found. Execution was refused."],
] as const;

export default function ExecutionSafetyProofPage() {
  return <>
    <SiteHeader inApp />
    <main className="wrap proof-main execution-safety-proof">
      <div className="proof-stamps">
        <span>EXECUTION SAFETY PROOF</span>
        <span>API_PROVENANCE_ONLY</span>
        <span>NO APPROVAL · NO SIGNATURE · NO BROADCAST</span>
      </div>
      <h1>A valid route was not<br />enough to execute.</h1>
      <p className="proof-lead">EquityRelay does not execute merely because an API returns a route. It verifies whether the authorization target is acceptable. This review found authenticated API provenance, but insufficient deployed-contract provenance, so the transaction stopped before wallet authorization.</p>

      <div className="proof-summary refusal-summary">
        <div><small>CLASSIFICATION</small><strong>{evidence.classification}</strong></div><span>·</span>
        <div><small>DECISION</small><strong>EXECUTION REFUSED</strong></div><span>·</span>
        <div><small>STATE</small><strong>{evidence.decision}</strong></div>
      </div>

      <section className="proof-section">
        <div className="eyebrow">01 / TWO DIFFERENT PROVENANCE QUESTIONS</div>
        <h2>Authenticated response does not verify deployed code.</h2>
        <div className="provenance-split">
          <article>
            <span>AUTHENTICATED API PROVENANCE</span>
            <strong>Established</strong>
            <p>Three signed Binance Web3 API build responses named <b>LiquidMesh</b> and returned the same address as both swap target and approval spender.</p>
          </article>
          <article className="refused">
            <span>DEPLOYED CONTRACT PROVENANCE</span>
            <strong>Not established</strong>
            <p>BscScan source and the detected diamond facets were unverified. No Binance or LiquidMesh deployment registry or deployment-specific audit naming this address was found.</p>
          </article>
        </div>
      </section>

      <section className="proof-section">
        <div className="eyebrow">02 / FRESH BUILD EVIDENCE · {evidence.observedAt.slice(0, 10)}</div>
        <h2>Three routes returned one authorization target.</h2>
        <p className="proof-code">Target and spender: <a href={`https://bscscan.com/address/${evidence.router}`} target="_blank" rel="noreferrer"><code>{evidence.router}</code></a></p>
        <div className="proof-table router-build-table">
          <div><span>Route</span><span>Provider / mode</span><span>Exact approval</span></div>
          {evidence.builds.map((build) => <div key={build.quoteId}>
            <strong>{build.route}</strong>
            <strong>{build.provider} · {build.executionMode}</strong>
            <strong>{build.approvalAmount}</strong>
          </div>)}
        </div>
        <p>Each allowance was exact and bounded to its route input. A bounded amount limits exposure; it does not make unverified or upgradeable contract code trustworthy.</p>
      </section>

      <section className="proof-section">
        <div className="eyebrow">03 / ONCHAIN IDENTITY</div>
        <h2>The address is an upgradeable diamond.</h2>
        <div className="proof-evidence-columns">
          <section><h2>Observed</h2><p>Chain: BNB Smart Chain · 56</p><p>Architecture: ERC-2535 diamond</p><p>Runtime bytecode hash:</p><p><code>{evidence.runtimeBytecodeHash}</code></p></section>
          <section><h2>Missing attribution</h2><p>BscScan verified source: No</p><p>Verified active facets: No</p><p>Published deployment registry: Not found</p><p>Deployment-specific audit: Not found</p></section>
        </div>
      </section>

      <section className="proof-section">
        <div className="eyebrow">04 / SAFETY SEQUENCE</div>
        <h2>Every gate narrowed the decision.</h2>
        <div className="safety-sequence" aria-label="Execution safety decision sequence">
          {safetySequence.map(([number, title, description], index) => <div key={number}>
            <span>{number}</span><strong>{title}</strong><p>{description}</p>{index < safetySequence.length - 1 && <i aria-hidden="true">→</i>}
          </div>)}
        </div>
      </section>

      <section className="proof-section refusal-decision">
        <div className="eyebrow">05 / FINAL DECISION</div>
        <h2>Execution refused.</h2>
        <p>Binance Wallet&apos;s high-risk, unverified-contract warning agreed with the missing deployed-code evidence. EquityRelay did not bypass the warning, request approval, request a transaction signature, or broadcast.</p>
        <strong>{evidence.decision}</strong>
      </section>

      <div className="proof-end">
        <div><strong>What this record proves</strong><p>The product can distinguish a route supplied by an authenticated API from an authorization target with independently defensible contract provenance—and can refuse at that boundary.</p></div>
        <Link href="/proof/venus-verifier" className="primary-button">See canonical Venus proof <span>↗</span></Link>
      </div>
    </main>
  </>;
}
