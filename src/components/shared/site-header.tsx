import Link from "next/link";

export function SiteHeader({ inApp = false }: { inApp?: boolean }) {
  return <header className="site-header wrap">
    <Link className="brand" href="/" aria-label="EquityRelay home"><span className="brand-mark" aria-hidden="true">E<span>↗</span></span><span>EquityRelay</span></Link>
    <nav className="nav-links" aria-label="Main navigation">
      {inApp ? <><Link href="/demo">Demo</Link><Link href="/status">Status</Link><Link href="/proof/execution-safety">Safety proof</Link></> : <><a href="#how">How it works</a><Link href="/demo">Demo</Link><Link href="/status">Status</Link></>}
    </nav>
    <Link className="header-action" href="/app">Open app<span aria-hidden="true">↗</span></Link>
  </header>;
}
