import { describe, expect, it } from "vitest";
import { assertRoundTripReceipt, roundTripReceiptHash, type EquityRelayRoundTripReceiptV2 } from "./receipt-hash";
const hash = `0x${"a".repeat(64)}`;
const receipt: EquityRelayRoundTripReceiptV2 = { version: "EquityRelayRoundTripReceiptV2", routeId: "route", status: "VERIFIED",
  wallet: "0x1111111111111111111111111111111111111111", product: { sourceAmountRaw: "22000000000000000",
    leg1TxHash: hash, leg1Block: "98", settledUsdtRaw: "5040000000000000000", leg2TxHash: hash, leg2Block: "99",
    settledNvdabRaw: "22010000000000000", venusSupplyTxHash: hash, venusSupplyBlock: "100" },
  recovery: { redeemTxHash: hash, redeemBlock: "101", actualNvdabRedeemedRaw: "22020000000000000", exitTxHash: hash,
    exitBlock: "102", actualUsdtRecoveredRaw: "5030000000000000000" },
  capital: { capitalInUsdtRaw: "5050000000000000000", actualCapitalRecoveredUsdtRaw: "5030000000000000000",
    gasSpentWei: "500000000000000", routeFrictionUsdtRaw: "20000000000000000" }, createdAt: "2026-09-30T12:00:00.000Z" };
describe("round-trip receipt integrity", () => {
  it("hashes separate capital, recovered capital, gas and friction deterministically", () => {
    expect(() => assertRoundTripReceipt(receipt)).not.toThrow();
    expect(roundTripReceiptHash(receipt)).toBe(roundTripReceiptHash(structuredClone(receipt)));
  });
  it("cannot become verified without canonical recovery evidence", () => {
    expect(() => assertRoundTripReceipt({ ...receipt, recovery: { ...receipt.recovery, redeemTxHash: "browser-claim" } })).toThrow("ROUND_TRIP_RECEIPT_INCOMPLETE");
    expect(JSON.stringify(receipt)).not.toMatch(/guaranteed|guarantee/i);
  });
});
