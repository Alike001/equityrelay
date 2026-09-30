import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pool", () => ({ executionPool: () => ({ query: mocks.query }) }));
import { readPublicProof } from "./public-proof";
import { receiptHash, roundTripReceiptHash, type EquityRelayExecutionReceiptV1, type EquityRelayRoundTripReceiptV2 } from "@/domain/execution/receipt-hash";

const id = "11111111-1111-4111-8111-111111111111";
describe("public durable route status", () => {
  it("shows no verified route for unknown ID and explicit unavailable without a database", async () => {
    expect(await readPublicProof("not-an-id")).toEqual({ status: "UNKNOWN" });
    mocks.query.mockResolvedValueOnce({ rows: [] });
    expect(await readPublicProof(id)).toEqual({ status: "UNKNOWN" });
    mocks.query.mockRejectedValueOnce(new Error("database unavailable"));
    expect(await readPublicProof(id)).toEqual({ status: "UNAVAILABLE" });
  });
  it("reads pending, failed and partial stop from durable state, never from browser data", async () => {
    for (const [lifecycle_state, expected] of [["LEG1_SWAP_PENDING", "PENDING"], ["FAILED", "FAILED"], ["PARTIAL_ROUTE_STOPPED", "PARTIAL_ROUTE_STOPPED"]]) {
      mocks.query.mockResolvedValueOnce({ rows: [{ lifecycle_state, status: null, payload_v1: null, receipt_hash: null,
        session_snapshot: { initialQuote: { outputRaw: "11000000000000000000", outputDecimals: 18 },
          initialLeg2Indicative: { outputRaw: "50000000000000000", outputDecimals: 18 } } }] });
      mocks.query.mockResolvedValueOnce({ rows: lifecycle_state === "PARTIAL_ROUTE_STOPPED" ? [{ stage: "LEG1_SWAP", amount_out_raw: "10900000000000000000" }] : [] });
      expect(await readPublicProof(id)).toMatchObject({ routeId: id, status: expected,
        quoted: { usdt: "11", nvdab: "0.05" }, actual: { usdt: lifecycle_state === "PARTIAL_ROUTE_STOPPED" ? "10.9" : null, nvdab: null } });
    }
    mocks.query.mockResolvedValueOnce({ rows: [{ lifecycle_state: "VERIFIED_RECEIPT", status: "VERIFIED", payload_v1: { status: "VERIFIED" }, receipt_hash: "0xfake" }] });
    expect(await readPublicProof(id)).toEqual({ status: "UNAVAILABLE" });
  });
  it("shows VERIFIED only when receipt hash and persisted steps/settlements agree", async () => {
    const receipt: EquityRelayExecutionReceiptV1 = { version: "EquityRelayExecutionReceiptV1", routeId: id, status: "VERIFIED",
      wallet: "0x1111111111111111111111111111111111111111", sourceAmountRaw: "500", maxExposureLossBps: 50,
      policyRecheck: "PASS", requiredApprovalStages: [], quoted: { leg1ObservedAt: "2026-09-29T00:00:00Z", leg2ObservedAt: "2026-09-29T00:01:00Z" },
      settled: { usdtRaw: "100", nvdabRaw: "499", startingShares: "0.05", finalShares: "0.0499", retentionPercent: "99.8" },
      venusInvestmentId: "investment", steps: ["LEG1_SWAP", "LEG2_SWAP", "VENUS_DEPOSIT"].map((stage, index) =>
        ({ stage, txHash: `0x${String(index + 1).repeat(64)}`, blockNumber: String(index + 10), approvalToken: null, approvalSpender: null, approvalAmountRaw: null })),
      createdAt: "2026-09-29T00:03:00Z" };
    mocks.query.mockResolvedValueOnce({ rows: [{ lifecycle_state: "VERIFIED_RECEIPT", wallet: receipt.wallet, original_source_raw: "500",
      max_exposure_loss_bps: 50, status: "VERIFIED", payload_v1: receipt, receipt_hash: receiptHash(receipt) }] });
    mocks.query.mockResolvedValueOnce({ rows: receipt.steps.map(step => ({ stage: step.stage, tx_hash: step.txHash, confirmed_block: step.blockNumber })) });
    mocks.query.mockResolvedValueOnce({ rows: [{ stage: "LEG1_SWAP", amount_out_raw: "100" }, { stage: "LEG2_SWAP", amount_out_raw: "499" }] });
    expect((await readPublicProof(id)).status).toBe("VERIFIED");
    mocks.query.mockResolvedValueOnce({ rows: [{ lifecycle_state: "VERIFIED_RECEIPT", wallet: receipt.wallet, original_source_raw: "500",
      max_exposure_loss_bps: 50, status: "VERIFIED", payload_v1: receipt, receipt_hash: receiptHash(receipt) }] });
    mocks.query.mockResolvedValueOnce({ rows: [{ stage: "LEG1_SWAP", tx_hash: receipt.steps[0].txHash, confirmed_block: "10" }] });
    mocks.query.mockResolvedValueOnce({ rows: [{ stage: "LEG1_SWAP", amount_out_raw: "100" }] });
    expect(await readPublicProof(id)).toEqual({ status: "UNAVAILABLE" });
  });
  it("reads a completed round trip only when product and recovery evidence agree", async () => {
    const hash = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
    const receipt: EquityRelayRoundTripReceiptV2 = { version: "EquityRelayRoundTripReceiptV2", routeId: id, status: "VERIFIED",
      wallet: "0x1111111111111111111111111111111111111111", product: { sourceAmountRaw: "22", leg1TxHash: hash("1"), leg1Block: "10",
        settledUsdtRaw: "5", leg2TxHash: hash("2"), leg2Block: "11", settledNvdabRaw: "21", venusSupplyTxHash: hash("3"), venusSupplyBlock: "12" },
      recovery: { redeemTxHash: hash("4"), redeemBlock: "13", actualNvdabRedeemedRaw: "20", exitTxHash: hash("5"), exitBlock: "14", actualUsdtRecoveredRaw: "4" },
      capital: { capitalInUsdtRaw: "6", actualCapitalRecoveredUsdtRaw: "4", gasSpentWei: null, routeFrictionUsdtRaw: "2" }, createdAt: "2026-09-30T00:00:00Z" };
    mocks.query.mockResolvedValueOnce({ rows: [{ lifecycle_state: "VENUS_CONFIRMED", recovery_state: "RECOVERED_AS_USDT", wallet: receipt.wallet,
      original_source_raw: "22", max_exposure_loss_bps: 50, status: "VERIFIED", payload_v1: null, receipt_hash: null,
      payload_v2: receipt, receipt_hash_v2: roundTripReceiptHash(receipt) }] });
    mocks.query.mockResolvedValueOnce({ rows: [["LEG1_SWAP", "1", "10"], ["LEG2_SWAP", "2", "11"], ["VENUS_DEPOSIT", "3", "12"],
      ["VENUS_REDEEM", "4", "13"], ["EXIT_SWAP", "5", "14"]].map(([stage,digit,confirmed_block]) => ({ stage, tx_hash: hash(digit), confirmed_block })) });
    mocks.query.mockResolvedValueOnce({ rows: [["LEG1_SWAP", "5"], ["LEG2_SWAP", "21"], ["VENUS_REDEEM", "20"], ["EXIT_SWAP", "4"]]
      .map(([stage,amount_out_raw]) => ({ stage, amount_out_raw })) });
    expect(await readPublicProof(id)).toEqual({ status: "VERIFIED", receipt, receiptHash: roundTripReceiptHash(receipt) });
  });
});
