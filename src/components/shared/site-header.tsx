import Link from "next/link";

export function SiteHeader({ inApp = false }: { inApp?: boolean }) {
  return <header className="site-header wrap">
    <Link className="brand" href="/" aria-label="EquityRelay home"><span className="brand-mark" aria-hidden="true">E<span>↗</span></span><span>EquityRelay</span></Link>
    <nav className="nav-links" aria-label="Main navigation">
      {inApp ? <><Link href="/">How it works</Link><Link href="/proof/execution-safety">Safety proof</Link><Link href="/proof/feasibility">Evidence</Link></> : <><a href="#how">How it works</a><a href="#safety">Safety</a><a href="#evidence">Evidence</a></>}
    </nav>
    <Link className="header-action" href={inApp ? "/proof/feasibility" : "/app"}>{inApp ? "Feasibility record" : "Open app"}<span aria-hidden="true">↗</span></Link>
  </header>;
}
