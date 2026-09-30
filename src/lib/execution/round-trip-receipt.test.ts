import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildRoundTripReceipt } from "./round-trip-receipt";
import type { ExecutionSession, SettlementEvidence } from "@/types/execution";

const wallet = "0x1111111111111111111111111111111111111111";
const hash = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const settlement = (tx: `0x${string}`, blockNumber: string, input: string, output: string): SettlementEvidence => ({ status: "CONFIRMED",
  transactionHash: tx, blockNumber, from: wallet, to: "0x2222222222222222222222222222222222222222", tokenTransfers: [],
  confirmedAt: "2026-09-30T00:00:00Z", actualAmountInRaw: input, actualAmountOutRaw: output,
  outputToken: "0x3333333333333333333333333333333333333333", outputRecipient: wallet });

describe("durable round-trip receipt writer", () => {
  it("derives capital and all transaction evidence from the server session", () => {
    const receipt = buildRoundTripReceipt({ id: "11111111-1111-4111-8111-111111111111", owner: wallet, originalSourceRaw: "22",
      policyRecheck: "PASS", leg1Settlement: settlement(hash("1"), "10", "22", "5"), leg2Settlement: settlement(hash("2"), "11", "5", "21"),
      submitted: { VENUS_DEPOSIT: { ...settlement(hash("3"), "12", "21", "20") } },
      testSetup: { settlement: settlement(hash("0"), "9", "6", "22") },
      recovery: { state: "ACTUAL_USDT_RECOVERED", redeemSettlement: settlement(hash("4"), "13", "20", "20"),
        exitSettlement: settlement(hash("5"), "14", "20", "4") } } as unknown as ExecutionSession, "2026-09-30T01:00:00Z");
    expect(receipt).toMatchObject({ product: { leg1TxHash: hash("1"), leg2TxHash: hash("2") },
      recovery: { redeemTxHash: hash("4"), exitTxHash: hash("5") },
      capital: { capitalInUsdtRaw: "6", actualCapitalRecoveredUsdtRaw: "4", routeFrictionUsdtRaw: "2" } });
  });
});
