import "server-only";
import { assertReceiptStatus, receiptHash, type EquityRelayExecutionReceiptV1 } from "@/domain/execution/receipt-hash";
import { executionPool } from "@/lib/db/pool";
import { formatUnits } from "viem";

export type PublicProof =
  | { status: "UNKNOWN" | "UNAVAILABLE" }
  | { status: "PENDING" | "FAILED" | "PARTIAL_ROUTE_STOPPED"; routeId: string;
      quoted: { usdt: string | null; nvdab: string | null }; actual: { usdt: string | null; nvdab: string | null } }
  | { status: "VERIFIED"; receipt: EquityRelayExecutionReceiptV1; receiptHash: string };

export async function readPublicProof(routeId: string): Promise<PublicProof> {
  if (!/^[0-9a-fA-F-]{36}$/.test(routeId)) return { status: "UNKNOWN" };
  try {
    const result = await executionPool().query(`SELECT r.lifecycle_state,r.wallet,r.original_source_raw::text,r.max_exposure_loss_bps,r.session_snapshot,p.status,p.payload_v1,p.receipt_hash
      FROM execution_routes r LEFT JOIN execution_receipts p ON p.route_id=r.route_id WHERE r.route_id=$1`, [routeId]);
    const row = result.rows[0] as { lifecycle_state: string; wallet: string; original_source_raw: string; max_exposure_loss_bps: number;
      session_snapshot?: { initialQuote?: { outputRaw?: string; outputDecimals?: number }; initialLeg2Indicative?: { outputRaw?: string; outputDecimals?: number } };
      status: string | null; payload_v1: EquityRelayExecutionReceiptV1 | null; receipt_hash: string | null } | undefined;
    if (!row) return { status: "UNKNOWN" };
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

// No VERIFIED writer is exposed while the live Venus event/position path is NOT_READY.
// A later phase must derive this payload from confirmed DB steps and canonical evidence.
