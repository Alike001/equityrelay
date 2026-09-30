import "server-only";
import type pg from "pg";
import { assertRoundTripReceipt, roundTripReceiptHash, type EquityRelayRoundTripReceiptV2 } from "@/domain/execution/receipt-hash";
import type { ExecutionSession } from "@/types/execution";

export function buildRoundTripReceipt(session: ExecutionSession, createdAt: string): EquityRelayRoundTripReceiptV2 {
  const recovery = session.recovery;
  const leg1 = session.leg1Settlement;
  const leg2 = session.leg2Settlement;
  const deposit = session.submitted.VENUS_DEPOSIT;
  const redeem = recovery?.redeemSettlement;
  const exit = recovery?.exitSettlement;
  if (!leg1 || !leg2 || deposit?.status !== "CONFIRMED" || !recovery || recovery.state !== "ACTUAL_USDT_RECOVERED" ||
      !redeem || !exit || session.policyRecheck !== "PASS") throw new Error("ROUND_TRIP_RECEIPT_INCOMPLETE");
  const capitalIn = session.testSetup?.settlement?.actualAmountInRaw ?? null;
  const recovered = exit.actualAmountOutRaw;
  const receipt: EquityRelayRoundTripReceiptV2 = {
    version: "EquityRelayRoundTripReceiptV2", routeId: session.id, status: "VERIFIED", wallet: session.owner,
    product: { sourceAmountRaw: session.originalSourceRaw, leg1TxHash: leg1.transactionHash, leg1Block: leg1.blockNumber,
      settledUsdtRaw: leg1.actualAmountOutRaw, leg2TxHash: leg2.transactionHash, leg2Block: leg2.blockNumber,
      settledNvdabRaw: leg2.actualAmountOutRaw, venusSupplyTxHash: deposit.transactionHash, venusSupplyBlock: deposit.blockNumber },
    recovery: { redeemTxHash: redeem.transactionHash, redeemBlock: redeem.blockNumber,
      actualNvdabRedeemedRaw: redeem.actualAmountOutRaw, exitTxHash: exit.transactionHash,
      exitBlock: exit.blockNumber, actualUsdtRecoveredRaw: recovered },
    capital: { capitalInUsdtRaw: capitalIn, actualCapitalRecoveredUsdtRaw: recovered, gasSpentWei: null,
      routeFrictionUsdtRaw: capitalIn === null ? null : (BigInt(capitalIn) - BigInt(recovered)).toString() },
    createdAt,
  };
  assertRoundTripReceipt(receipt);
  return receipt;
}

export async function persistRoundTripReceipt(client: pg.PoolClient, session: ExecutionSession, createdAt: string): Promise<void> {
  const receipt = buildRoundTripReceipt(session, createdAt);
  await client.query(`INSERT INTO execution_receipts(route_id,status,payload_v2,receipt_hash_v2)
    VALUES($1,'VERIFIED',$2,$3)
    ON CONFLICT(route_id) DO UPDATE SET status='VERIFIED',payload_v2=EXCLUDED.payload_v2,
      receipt_hash_v2=EXCLUDED.receipt_hash_v2,created_at=now()`,
    [session.id, JSON.stringify(receipt), roundTripReceiptHash(receipt)]);
}
