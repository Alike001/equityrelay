import { RoutePreviewForm } from "@/components/route/route-preview-form";
import { SiteHeader } from "@/components/shared/site-header";
import { WalletAuth } from "@/components/route/wallet-auth";

export default function AppPage() {
  return <><SiteHeader inApp /><main className="wrap app-main"><div className="app-topline"><span>DESTINATION ROUTER / 01</span><span>LIVE READ-ONLY PREVIEW</span></div><WalletAuth /><RoutePreviewForm /></main></>;
}
