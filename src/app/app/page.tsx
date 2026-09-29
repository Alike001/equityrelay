import { RoutePreviewForm } from "@/components/route/route-preview-form";
import { SiteHeader } from "@/components/shared/site-header";

export default function AppPage() {
  return <><SiteHeader inApp /><main className="wrap app-main"><div className="app-topline"><span>DESTINATION ROUTER / 01</span><span>LIVE READ-ONLY PREVIEW</span></div><RoutePreviewForm /></main></>;
}
