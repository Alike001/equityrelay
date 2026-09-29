import { SiteHeader } from "@/components/shared/site-header";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function RouteProofPage({ params }: { params: Promise<{ id: string }> }) {
  await params;
  // A future durable receipt repository will supply VerifiedRouteProof here.
  // There is no execution receipt repository in Phase 3A. Never synthesize a receipt.
  return <><SiteHeader /><main className="wrap proof-main" style={{ paddingBlock: "72px 120px" }}><div className="eyebrow">ROUTE PROOF</div><h1>No verified route yet.</h1><p>EquityRelay has not completed a mainnet route. A transaction hash or an indicative quote is not a verified execution receipt.</p></main></>;
}
