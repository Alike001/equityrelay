import { SiteHeader } from "@/components/shared/site-header";
import { readPublicProof } from "@/lib/execution/public-proof";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function RouteProofPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proof = await readPublicProof(id);
  const title = proof.status === "VERIFIED" ? "NVIDIA reached Venus." : proof.status === "PARTIAL_ROUTE_STOPPED" ? "Partial route stopped." :
    proof.status === "FAILED" ? "Route stopped after a failed transaction." : proof.status === "PENDING" ? "Waiting for canonical confirmation." :
    proof.status === "UNAVAILABLE" ? "Route evidence is unavailable." : "No verified route yet.";
  return <><SiteHeader /><main className="wrap proof-main" style={{ paddingBlock: "72px 120px" }}><div className="eyebrow">ROUTE PROOF · {proof.status}</div><h1>{title}</h1>
    {proof.status === "VERIFIED" ? <><p>Actual settled retention: {proof.receipt.settled.retentionPercent}%</p><p>Receipt hash: <code>{proof.receiptHash}</code></p><p>Wallet: {proof.receipt.wallet.slice(0, 6)}…{proof.receipt.wallet.slice(-4)}</p>
      <ul>{proof.receipt.steps.map(step => <li key={step.stage}>{step.stage} · block {step.blockNumber} · <a href={`https://bscscan.com/tx/${step.txHash}`} target="_blank" rel="noopener noreferrer">View BscScan transaction ↗</a></li>)}</ul></>
      : <><p>{proof.status === "PARTIAL_ROUTE_STOPPED" ? "The first conversion completed. The policy stopped further action; funds remain in USDT." :
        proof.status === "UNKNOWN" ? "EquityRelay has not verified a mainnet route with this ID. A hash or quote alone is not proof." :
        proof.status === "UNAVAILABLE" ? "Durable execution evidence could not be read or validated. No result is assumed." :
        "A submitted transaction is not a verified execution receipt. The route advances only after canonical chain evidence."}</p>
      {"quoted" in proof && <div className="proof-evidence-columns"><section><h2>Quoted preview</h2><p>USDT: {proof.quoted.usdt ?? "Unavailable"}</p><p>NVDAB: {proof.quoted.nvdab ?? "Unavailable"}</p></section>
        <section><h2>Actual settled</h2><p>USDT: {proof.actual.usdt ?? "Not confirmed"}</p><p>NVDAB: {proof.actual.nvdab ?? "Not confirmed"}</p></section></div>}</>}</main></>;
}
