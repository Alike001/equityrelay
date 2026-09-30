import "server-only";
import { assertReceiptStatus, assertRoundTripReceipt, receiptHash, roundTripReceiptHash,
  type EquityRelayExecutionReceiptV1, type EquityRelayRoundTripReceiptV2 } from "@/domain/execution/receipt-hash";
import { executionPool } from "@/lib/db/pool";
import { formatUnits } from "viem";

export type PublicProof =
  | { status: "UNKNOWN" | "UNAVAILABLE" }
  | { status: "PENDING" | "FAILED" | "PARTIAL_ROUTE_STOPPED"; routeId: string;
      quoted: { usdt: string | null; nvdab: string | null }; actual: { usdt: string | null; nvdab: string | null } }
  | { status: "VERIFIED"; receipt: EquityRelayExecutionReceiptV1 | EquityRelayRoundTripReceiptV2; receiptHash: string };

export async function readPublicProof(routeId: string): Promise<PublicProof> {
  if (!/^[0-9a-fA-F-]{36}$/.test(routeId)) return { status: "UNKNOWN" };
  try {
    const result = await executionPool().query(`SELECT r.lifecycle_state,r.recovery_state,r.wallet,r.original_source_raw::text,r.max_exposure_loss_bps,r.session_snapshot,
      p.status,p.payload_v1,p.receipt_hash,p.payload_v2,p.receipt_hash_v2
      FROM execution_routes r LEFT JOIN execution_receipts p ON p.route_id=r.route_id WHERE r.route_id=$1`, [routeId]);
    const row = result.rows[0] as { lifecycle_state: string; recovery_state: string | null; wallet: string; original_source_raw: string; max_exposure_loss_bps: number;
      session_snapshot?: { initialQuote?: { outputRaw?: string; outputDecimals?: number }; initialLeg2Indicative?: { outputRaw?: string; outputDecimals?: number } };
      status: string | null; payload_v1: EquityRelayExecutionReceiptV1 | null; receipt_hash: string | null;
      payload_v2: EquityRelayRoundTripReceiptV2 | null; receipt_hash_v2: string | null } | undefined;
    if (!row) return { status: "UNKNOWN" };
    if (row.status === "VERIFIED" && row.payload_v2 && row.receipt_hash_v2) {
      assertRoundTripReceipt(row.payload_v2);
      if (row.recovery_state !== "RECOVERED_AS_USDT" || roundTripReceiptHash(row.payload_v2) !== row.receipt_hash_v2 ||
          row.wallet.toLowerCase() !== row.payload_v2.wallet.toLowerCase() || row.original_source_raw !== row.payload_v2.product.sourceAmountRaw)
        return { status: "UNAVAILABLE" };
      const [steps, settlements] = await Promise.all([
        executionPool().query("SELECT stage,tx_hash,confirmed_block::text FROM execution_steps WHERE route_id=$1 AND status='CONFIRMED'", [routeId]),
        executionPool().query("SELECT stage,amount_out_raw::text FROM settlement_evidence WHERE route_id=$1", [routeId]),
      ]);
      const confirmed = new Map(steps.rows.map(item => [String(item.stage), item]));
      const amounts = new Map(settlements.rows.map(item => [String(item.stage), String(item.amount_out_raw)]));
      const expected = [["LEG1_SWAP", row.payload_v2.product.leg1TxHash, row.payload_v2.product.leg1Block],
        ["LEG2_SWAP", row.payload_v2.product.leg2TxHash, row.payload_v2.product.leg2Block],
        ["VENUS_DEPOSIT", row.payload_v2.product.venusSupplyTxHash, row.payload_v2.product.venusSupplyBlock],
        ["VENUS_REDEEM", row.payload_v2.recovery.redeemTxHash, row.payload_v2.recovery.redeemBlock],
        ["EXIT_SWAP", row.payload_v2.recovery.exitTxHash, row.payload_v2.recovery.exitBlock]] as const;
      if (expected.some(([stage, hash, block]) => confirmed.get(stage)?.tx_hash?.toLowerCase() !== hash.toLowerCase() ||
          confirmed.get(stage)?.confirmed_block !== block) || amounts.get("LEG1_SWAP") !== row.payload_v2.product.settledUsdtRaw ||
          amounts.get("LEG2_SWAP") !== row.payload_v2.product.settledNvdabRaw ||
          amounts.get("VENUS_REDEEM") !== row.payload_v2.recovery.actualNvdabRedeemedRaw ||
          amounts.get("EXIT_SWAP") !== row.payload_v2.recovery.actualUsdtRecoveredRaw) return { status: "UNAVAILABLE" };
      return { status: "VERIFIED", receipt: row.payload_v2, receiptHash: row.receipt_hash_v2 };
    }
    if (row.status === "VERIFIED" && row.payload_v1 && row.receipt_hash) {
      assertReceiptStatus(row.payload_v1);
      if (row.payload_v1.status !== "VERIFIED" || row.lifecycle_state !== "VERIFIED_RECEIPT" || receiptHash(row.payload_v1) !== row.receipt_hash)
        return { status: "UNAVAILABLE" };
      if (row.wallet.toLowerCase() !== row.payload_v1.wallet.toLowerCase() || row.original_source_raw !== row.payload_v1.sourceAmountRaw ||
          row.max_exposure_loss_bps !== row.payload_v1.maxExposureLossBps) return { status: "UNAVAILABLE" };
      const [steps, settlements] = await Promise.all([
        executionPool().query("SELECT stage,tx_hash,confirmed_block::text FROM execution_steps WHERE route_id=$1 AND status='CONFIRMED'", [routeId]),
        executionPool().query("SELECT stage,amount_out_raw::text FROM settlement_evidence WHERE route_id=$1", [routeId]),
      ]);
      const recordedSteps = new Map(steps.rows.map(item => [String(item.stage), item]));
      if (row.payload_v1.steps.some(step => {
        const stored = recordedSteps.get(step.stage);
        return !stored || stored.tx_hash?.toLowerCase() !== step.txHash.toLowerCase() || stored.confirmed_block !== step.blockNumber;
      })) return { status: "UNAVAILABLE" };
      const amounts = new Map(settlements.rows.map(item => [String(item.stage), String(item.amount_out_raw)]));
      if (amounts.get("LEG1_SWAP") !== row.payload_v1.settled.usdtRaw || amounts.get("LEG2_SWAP") !== row.payload_v1.settled.nvdabRaw)
        return { status: "UNAVAILABLE" };
      return { status: "VERIFIED", receipt: row.payload_v1, receiptHash: row.receipt_hash };
    }
    const settlement = await executionPool().query("SELECT stage,amount_out_raw::text FROM settlement_evidence WHERE route_id=$1 AND stage IN ('LEG1_SWAP','LEG2_SWAP')", [routeId]);
    const amounts = new Map(settlement.rows.map(item => [String(item.stage), String(item.amount_out_raw)]));
    const leg1 = row.session_snapshot?.initialQuote, leg2 = row.session_snapshot?.initialLeg2Indicative;
    const display = (raw: string | undefined, decimals: number | undefined): string | null =>
      raw && /^\d+$/.test(raw) && Number.isInteger(decimals) && decimals! >= 0 && decimals! <= 36 ? formatUnits(BigInt(raw), decimals!) : null;
    const status = row.lifecycle_state === "FAILED" ? "FAILED" : row.lifecycle_state === "PARTIAL_ROUTE_STOPPED" ? "PARTIAL_ROUTE_STOPPED" : "PENDING";
    if (status === "PARTIAL_ROUTE_STOPPED" && !amounts.get("LEG1_SWAP")) return { status: "UNAVAILABLE" };
    return { status, routeId, quoted: { usdt: display(leg1?.outputRaw, leg1?.outputDecimals), nvdab: display(leg2?.outputRaw, leg2?.outputDecimals) },
      actual: { usdt: display(amounts.get("LEG1_SWAP"), leg1?.outputDecimals), nvdab: display(amounts.get("LEG2_SWAP"), leg2?.outputDecimals) } };
  } catch { return { status: "UNAVAILABLE" }; }
}
