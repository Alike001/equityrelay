import { describe, expect, it } from "vitest";
import { assertReceiptStatus, receiptHash, type EquityRelayExecutionReceiptV1 } from "./receipt-hash";

const hash = (character: string) => `0x${character.repeat(64)}`;
const proof: EquityRelayExecutionReceiptV1 = { version: "EquityRelayExecutionReceiptV1", routeId: "route-1", status: "VERIFIED",
  wallet: "0x1111111111111111111111111111111111111111", sourceAmountRaw: "50000000000000000", maxExposureLossBps: 50,
  policyRecheck: "PASS", requiredApprovalStages: [],
  quoted: { leg1ObservedAt: "2026-09-29T00:00:00Z", leg2ObservedAt: "2026-09-29T00:10:00Z" },
  settled: { usdtRaw: "11000000", nvdabRaw: "49900000000000000", startingShares: "0.05", finalShares: "0.0499", retentionPercent: "99.8" },
  venusInvestmentId: "live-id", steps: ["LEG1_SWAP", "LEG2_SWAP", "VENUS_DEPOSIT"].map((stage, i) =>
    ({ stage, txHash: hash(String(i + 1)), blockNumber: String(100 + i), approvalToken: null, approvalSpender: null, approvalAmountRaw: null })),
  createdAt: "2026-09-29T00:30:00Z" };
describe("durable receipt identity", () => {
  it("hashes canonical server fields independent of object key order", () => {
    expect(receiptHash(proof)).toBe(receiptHash({ ...proof, settled: { ...proof.settled } }));
    expect(receiptHash(proof)).not.toBe(receiptHash({ ...proof, settled: { ...proof.settled, usdtRaw: "11000001" } }));
  });
  it("cannot claim verified before all hashes, blocks and actual values exist", () => {
    expect(() => assertReceiptStatus(proof)).not.toThrow();
    expect(() => assertReceiptStatus({ ...proof, steps: proof.steps.slice(0, 2) })).toThrow("VERIFIED_RECEIPT_INCOMPLETE");
    expect(() => assertReceiptStatus({ ...proof, settled: { ...proof.settled, usdtRaw: null } })).toThrow("VERIFIED_RECEIPT_INCOMPLETE");
    expect(() => assertReceiptStatus({ ...proof, steps: [{ ...proof.steps[0], txHash: "fake" }, ...proof.steps.slice(1)] })).toThrow("VERIFIED_RECEIPT_INCOMPLETE");
    expect(() => assertReceiptStatus({ ...proof, policyRecheck: "BLOCKED" })).toThrow("VERIFIED_RECEIPT_INCOMPLETE");
    expect(() => assertReceiptStatus({ ...proof, requiredApprovalStages: ["LEG1_APPROVAL"] })).toThrow("VERIFIED_RECEIPT_INCOMPLETE");
    expect(() => assertReceiptStatus({ ...proof, settled: { ...proof.settled, retentionPercent: "99.9" } })).toThrow("VERIFIED_RECEIPT_EXPOSURE_INVALID");
  });
});
