import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/shared/site-header";

export const metadata: Metadata = { title: "Demo | EquityRelay", description: "A judge-friendly path through the live router, decision explanation and public evidence." };

function DemoFilm() {
  const source = process.env.NEXT_PUBLIC_EQUITYRELAY_DEMO_VIDEO_URL;
  if (source?.startsWith("https://www.youtube-nocookie.com/embed/")) return <iframe src={source} title="EquityRelay narrated demo" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy" />;
  if (source?.startsWith("/demo/") && source.endsWith(".mp4")) return <video controls playsInline preload="metadata"><source src={source} type="video/mp4" />Your browser cannot play this recording.</video>;
  return <div className="demo-film-empty"><span aria-hidden="true">03:00</span><strong>Narrated demo reserved</strong><p>The final recording will appear here after the production UI is accepted. No placeholder playback or fabricated footage is shown.</p></div>;
}

const links = [
  ["01", "TRY THE PRODUCT", "Build a live route", "Use genuine Binance data when available and get a deterministic policy result.", "/app"],
  ["02", "EXAMINE THE DECISION", "Why this route?", "Follow the issuer constraint, settlement path, exposure math and authorization boundary.", "/why-this-route"],
  ["03", "VERIFY THE EVIDENCE", "Execution safety", "See the cancelled approval review, provenance finding and recorded operator refusal.", "/proof/execution-safety"],
  ["04", "VERIFY THE EVIDENCE", "Venus verification", "Inspect labeled historical canonical evidence used to validate the verifier.", "/proof/venus-verifier"],
] as const;

export default function DemoPage() {
  return <><SiteHeader inApp /><main className="wrap demo-main"><section className="demo-hero"><div className="eyebrow">BNB HACK · TOKENIZED STOCKS EDITION</div><h1>See EquityRelay decide.</h1><p>One underlying stock. Different issuer rails. One destination. Explicit authorization boundaries.</p></section><section className="demo-film" aria-labelledby="demo-film-title"><div className="demo-section-heading"><span>00 / VIDEO</span><h2 id="demo-film-title">The three-minute walkthrough.</h2></div><div className="demo-film-frame"><DemoFilm /></div></section><section className="demo-link-grid" aria-label="Demo journey">{links.map(([number,kicker,title,body,href]) => <Link href={href} key={number}><span>{number} · {kicker}</span><strong>{title}</strong><p>{body}</p><b>Open <i aria-hidden="true">↗</i></b></Link>)}</section><section className="demo-capabilities"><div className="demo-section-heading"><span>05 / CAPABILITIES AND LIMITATIONS</span><h2>Evidence keeps its label.</h2></div><div><article><span className="demo-status live">LIVE DATA</span><p>Route previews call current Binance APIs. Unavailable remains unavailable.</p></article><article><span className="demo-status historical">HISTORICAL CANONICAL EVIDENCE</span><p>Venus fixtures prove verifier behavior, not EquityRelay execution.</p></article><article><span className="demo-status recorded">RECORDED SECURITY DECISION</span><p>The operator cancelled the wallet review; later provenance research recorded the refusal.</p></article><article><span className="demo-status disarmed">MAINNET EXECUTION DISARMED</span><p>The production server will not deliver wallet transaction fields.</p></article></div></section><div className="demo-close"><p>The API proposes a route. EquityRelay determines what can be justified for authorization.</p><Link href="/status">Check system status ↗</Link></div></main></>;
}
