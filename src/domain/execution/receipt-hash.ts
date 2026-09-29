import { keccak256, stringToHex } from "viem";
import Decimal from "decimal.js";

export type EquityRelayExecutionReceiptV1 = {
  version: "EquityRelayExecutionReceiptV1";
  routeId: string;
  status: "PENDING" | "FAILED" | "PARTIAL_ROUTE_STOPPED" | "VERIFIED";
  wallet: string;
  sourceAmountRaw: string;
  maxExposureLossBps: number;
  policyRecheck: "PASS" | "BLOCKED" | null;
  requiredApprovalStages: Array<"LEG1_APPROVAL" | "LEG2_APPROVAL" | "VENUS_APPROVAL">;
  quoted: { leg1ObservedAt: string; leg2ObservedAt: string | null };
  settled: { usdtRaw: string | null; nvdabRaw: string | null; startingShares: string | null; finalShares: string | null; retentionPercent: string | null };
  venusInvestmentId: string | null;
  steps: Array<{ stage: string; txHash: string; blockNumber: string; approvalToken: string | null; approvalSpender: string | null; approvalAmountRaw: string | null }>;
  createdAt: string;
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
}
export function receiptHash(receipt: EquityRelayExecutionReceiptV1): `0x${string}` {
  return keccak256(stringToHex(canonical(receipt)));
}
export function assertReceiptStatus(receipt: EquityRelayExecutionReceiptV1): void {
  if (receipt.status !== "VERIFIED") return;
  const stages = new Set(receipt.steps.map(x => x.stage));
  if (!stages.has("LEG1_SWAP") || !stages.has("LEG2_SWAP") || !stages.has("VENUS_DEPOSIT") ||
      stages.size !== receipt.steps.length || receipt.policyRecheck !== "PASS" ||
      receipt.requiredApprovalStages.some(stage => !stages.has(stage) || !receipt.steps.some(step => step.stage === stage &&
        !!step.approvalToken && !!step.approvalSpender && !!step.approvalAmountRaw)) ||
      receipt.steps.some(step => !/^0x[a-fA-F0-9]{64}$/.test(step.txHash) || !/^[1-9]\d*$/.test(step.blockNumber)) ||
      !receipt.settled.usdtRaw || !receipt.settled.nvdabRaw || !receipt.settled.startingShares ||
      !receipt.settled.finalShares || !receipt.settled.retentionPercent || !receipt.venusInvestmentId ||
      !receipt.quoted.leg2ObservedAt) throw new Error("VERIFIED_RECEIPT_INCOMPLETE");
  try {
    const start = new Decimal(receipt.settled.startingShares), end = new Decimal(receipt.settled.finalShares);
    const retention = end.div(start).mul(100);
    if (!start.isFinite() || !end.isFinite() || start.lte(0) || end.lte(0) ||
        !retention.eq(receipt.settled.retentionPercent) ||
        retention.lt(new Decimal(100).minus(new Decimal(receipt.maxExposureLossBps).div(100)))) throw new Error();
  } catch { throw new Error("VERIFIED_RECEIPT_EXPOSURE_INVALID"); }
}
