import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/shared/site-header";

export const metadata: Metadata = { title: "Why this route? | EquityRelay", description: "A plain-language explanation of representation compatibility, settlement, exposure policy and authorization boundaries." };

const routeStory = [
  ["01", "User destination", "I own NVIDIA exposure. I want to use it on Venus."],
  ["02", "Compatibility constraint", "Ondo's NVDAon is not the representation accepted by the configured Venus NVIDIA market."],
  ["03", "Valid settlement path", "A direct NVDAon → NVDAB attempt returned Binance code 40368 in the dated 2026-09-29 feasibility study. The supported path used USDT: NVDAon → USDT → NVDAB → Venus."],
  ["04", "Exposure preservation", "EquityRelay multiplies each wrapper amount by its live token-to-share ratio. The live preview compares projected underlying shares with the user's minimum—not raw token counts."],
  ["05", "Authorization boundary", "A financially acceptable quote does not establish that its approval target has defensible deployed-contract provenance."],
  ["06", "Current result", "The app reports route policy, historical verifier capability, authorization evidence and execution state separately. Production execution is disarmed."],
] as const;

export default function WhyThisRoutePage() {
  return <><SiteHeader inApp /><main className="wrap route-story-main"><div className="proof-stamps"><span>WHY THIS ROUTE?</span><span>PLAIN-LANGUAGE WALKTHROUGH</span><span>NO TRANSACTIONS</span></div><h1>One stock exposure.<br />Two issuer rails.</h1><p className="proof-lead">The destination determines which representation can be used. EquityRelay compiles the compatible settlement path, checks economic exposure, and keeps authorization trust as a separate decision.</p><div className="route-story-list">{routeStory.map(([number,title,body]) => <article key={number}><span>{number}</span><div><h2>{title}</h2><p>{body}</p></div></article>)}</div><section className="decision-language"><div><small>QUOTE / POLICY</small><strong>PASS or BLOCKED</strong><p>Computed from a fresh route and the user&apos;s exposure limit.</p></div><div><small>VENUS VERIFIER</small><strong>VALIDATED HISTORICALLY</strong><p>Verifier capability; it does not mean a live route executed.</p></div><div><small>AUTHORIZATION</small><strong>RECORDED REFUSAL</strong><p>The reviewed router had API provenance only. The operator cancelled before signing.</p></div><div><small>EXECUTION</small><strong>DISARMED</strong><p>No approval, swap, supply or recovery transaction was broadcast.</p></div></section><div className="route-story-actions"><Link className="primary-button" href="/app">Build a live route <span>↗</span></Link><Link className="secondary-button" href="/proof/execution-safety">Inspect the refusal <span>↗</span></Link></div></main></>;
}
