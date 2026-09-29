import type { ExecutionSession, VerifiedExecutionReceipt } from "@/types/execution";

export function PartialRouteStopped({ session }: { session: ExecutionSession }) {
  if (session.stage !== "PARTIAL_ROUTE_STOPPED") return null;
  const limit = (session.intent.maxExposureLossBps / 100).toFixed(2);
  return <section className="partial-route-stopped" role="alert"><span className="eyebrow">PARTIAL ROUTE STOPPED</span><h2>Your first conversion completed.</h2><p>The market changed before the second step. Continuing would exceed your {limit}% exposure-loss limit.</p><p>Your funds remain in USDT. Nothing else was submitted.</p><p>You may start a new route manually later. No rollback or automatic retry is scheduled.</p></section>;
}

export function VerifiedRouteProof({ receipt }: { receipt: VerifiedExecutionReceipt }) {
  return <section className="verified-route-proof"><div className="eyebrow">VERIFIED EXECUTION RECEIPT</div><h1>NVIDIA reached Venus.</h1><p>Actual settled retention: {receipt.actual.realizedRetentionPercent}%</p><p>Starting NVIDIA-equivalent exposure: {receipt.actual.startingShares} · Final: {receipt.actual.finalShares}</p>
    <h2>Confirmed transactions</h2><ul>{receipt.transactionHashes.map((hash, index) => <li key={`${hash}-${index}`}><a href={`https://bscscan.com/tx/${hash}`} target="_blank" rel="noopener noreferrer">View transaction {index + 1} on BscScan ↗</a></li>)}</ul>
    <p>Quoted values and settled values are recorded separately. Receipt created {receipt.createdAt}.</p></section>;
}
