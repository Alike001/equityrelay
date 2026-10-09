import Link from "next/link";
import { RoutePreviewForm } from "@/components/route/route-preview-form";
import { SiteHeader } from "@/components/shared/site-header";
import { WalletAuth } from "@/components/route/wallet-auth";

export default function AppPage() {
  return <><SiteHeader inApp /><main className="wrap app-main"><div className="app-topline"><span>DESTINATION ROUTER / 01</span><span>LIVE READ-ONLY PREVIEW</span></div><div className="app-safety-note"><strong>Route data is one safety input.</strong><span>EquityRelay separately checks whether an authorization target is acceptable before execution.</span><Link href="/proof/execution-safety">View execution safety proof ↗</Link></div><WalletAuth /><RoutePreviewForm /></main></>;
}
