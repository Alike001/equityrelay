import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/shared/site-header";
import { ReadinessReview } from "@/components/readiness/readiness-review";

export const dynamic = "force-dynamic";
export default function ReadinessPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <><SiteHeader /><main className="wrap readiness-main"><div className="app-topline"><span>MAINNET PROOF READINESS</span><span>LOCAL TEST SURFACE</span></div><ReadinessReview /></main></>;
}
