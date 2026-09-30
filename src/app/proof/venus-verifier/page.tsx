import Link from "next/link";
import { formatUnits } from "viem";
import { SiteHeader } from "@/components/shared/site-header";
import fixture from "@/domain/execution/fixtures/venus-nvdab-mint-mainnet.json";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function VenusVerifierPage() {
  const supplied = formatUnits(BigInt(fixture.receipt.logs[0].data), 18);
  const minted = formatUnits(BigInt(fixture.position.receiverVTokenBalanceAfterRaw), 8);

  return <>
    <SiteHeader inApp />
    <main className="wrap proof-main">
      <div className="proof-stamps"><span>VENUS VERIFIER VALIDATION</span><span>HISTORICAL MAINNET TRANSACTION</span><span>NO FUNDS MOVED BY EQUITYRELAY</span></div>
      <h1>Canonical supply evidence,<br />validated end to end.</h1>
      <p className="proof-lead">This public BSC transaction validates EquityRelay&apos;s Venus evidence verifier against a real NVDAB supply. It is historical protocol activity and is not an EquityRelay execution.</p>

      <div className="proof-summary">
        <div><small>VERIFIER</small><strong>PASS</strong></div><span>·</span>
        <div><small>EVENT PATH</small><strong>Direct Mint</strong></div><span>·</span>
        <div><small>BLOCK</small><strong>{fixture.transaction.blockNumber}</strong></div>
      </div>

      <section className="proof-section">
        <div className="eyebrow">01 / CANONICAL RECEIPT</div>
        <h2>The supply settled successfully.</h2>
        <p>The BSC receipt succeeded and called the live vNVDAB market with zero native value. The verifier decoded <code>mint(uint256)</code> and matched one Venus <code>Mint</code> event.</p>
        <p className="proof-code">Transaction: <a href={`https://bscscan.com/tx/${fixture.transaction.hash}`} target="_blank" rel="noreferrer"><code>{fixture.transaction.hash}</code></a></p>
      </section>

      <section className="proof-section">
        <div className="eyebrow">02 / TOKEN MOVEMENT</div>
        <h2>Receipt logs agree on the amounts.</h2>
        <div className="proof-table">
          <div><span>Evidence</span><span>Asset</span><span>Amount</span></div>
          <div><strong>Wallet → market</strong><strong>NVDAB</strong><strong>{supplied}</strong></div>
          <div><strong>Market → receiver</strong><strong>vNVDAB</strong><strong>{minted}</strong></div>
        </div>
        <p>Supplier and receiver: <code>{shortAddress(fixture.transaction.from)}</code>. The exact NVDAB transfer, Mint event, and vNVDAB transfer each occur once and agree.</p>
      </section>

      <section className="proof-section">
        <div className="eyebrow">03 / POSITION EVIDENCE</div>
        <h2>The receiver position changed by the minted amount.</h2>
        <p>At block {fixture.position.beforeBlock}, the receiver held 0 vNVDAB. At confirmed block {fixture.position.afterBlock}, the balance and account snapshot both reported {minted} vNVDAB. The exact increase matches the receipt event.</p>
      </section>

      <div className="proof-end">
        <div><strong>What this record proves</strong><p>The verifier recognizes the live market&apos;s canonical supply evidence. This record does not claim that EquityRelay executed a route.</p></div>
        <Link href="/proof/feasibility" className="primary-button">See route feasibility <span>↗</span></Link>
      </div>
    </main>
  </>;
}
