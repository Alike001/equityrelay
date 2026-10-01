import { describe, expect, it } from "vitest";
import type { ExecutionActionV1 } from "./action";
import { beginVenusRecovery, prepareExitRecovery, prepareRedeemRecovery, recordRecoveredUsdt, recordRedeemedNvdab, recoveryAfterProductStop } from "./recovery";
import { NVDAB_ADDRESS, USDT_ADDRESS, VENUS_VNVDAB_ADDRESS } from "@/domain/routing/identity";
import type { ExecutionSession, SettlementEvidence } from "@/types/execution";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const router = "0x2222222222222222222222222222222222222222" as const;
const hash = `0x${"1".repeat(64)}` as const;
function base() { return { id: "route", owner: wallet, intent: { underlying: "NVDA" }, stage: "VENUS_CONFIRMED", venus: { investable: true, investmentId: "venus" },
  events: [], reviews: {}, submitted: {}, recovery: null } as unknown as ExecutionSession; }
const position = { market: VENUS_VNVDAB_ADDRESS, investmentId: "venus", underlyingAmountRaw: "22000000000000000",
  vTokenAmountRaw: "2200000", transactionHash: hash, blockNumber: "100" };
function redeemAction(): ExecutionActionV1 { return { version: "ExecutionActionV1", routeId: "route", stage: "VENUS_REDEEM", kind: "REDEEM",
  chainId: 56, from: wallet, to: VENUS_VNVDAB_ADDRESS, data: "0x12345678", valueWei: "0", tokenIn: VENUS_VNVDAB_ADDRESS,
  tokenOut: NVDAB_ADDRESS, amountInRaw: position.vTokenAmountRaw, approvalSpender: null, approvalAmountRaw: null, planIdentity: "venus", planRevision: "1" }; }
function settlement(input: string, output: string, token: typeof NVDAB_ADDRESS | typeof USDT_ADDRESS): SettlementEvidence { return { status: "CONFIRMED", transactionHash: hash,
  blockNumber: "101", from: wallet, to: router, tokenTransfers: [], confirmedAt: "2026-09-30T12:00:00.000Z",
  actualAmountInRaw: input, actualAmountOutRaw: output, outputToken: token, outputRecipient: wallet }; }

describe("durable recovery lifecycle", () => {
  it("uses canonical redeemed NVDAB as the only fresh exit input", () => {
    let session = beginVenusRecovery(base(), position);
    session = prepareRedeemRecovery(session, redeemAction(), "22010000000000000");
    session = { ...session, recovery: { ...session.recovery!, state: "REDEEM_CONFIRMED" } };
    session = recordRedeemedNvdab(session, settlement(position.vTokenAmountRaw, "22020000000000000", NVDAB_ADDRESS));
    const quote = { leg: 2 as const, from: NVDAB_ADDRESS, to: USDT_ADDRESS, inputRaw: "22020000000000000", outputRaw: "5000000000000000000",
      quoteId: "fresh-exit", vendor: null, tradeFeeUsd: null, priceImpactPercent: null, observedAt: "2026-09-30T12:01:00.000Z", expiresAt: null };
    const action = { ...redeemAction(), stage: "EXIT_SWAP" as const, kind: "SWAP" as const, to: router, tokenIn: NVDAB_ADDRESS,
      tokenOut: USDT_ADDRESS, amountInRaw: quote.inputRaw, planIdentity: quote.quoteId! };
    session = prepareExitRecovery(session, quote, action);
    expect(session.recovery).toMatchObject({ state: "EXIT_REVIEW_READY", recoveryState: "RECOVERABLE_AS_NVDAB" });
    expect(() => prepareExitRecovery({ ...session, recovery: { ...session.recovery!, state: "ACTUAL_NVDAB_REDEEMED" } },
      { ...quote, inputRaw: "22010000000000000" }, { ...action, amountInRaw: "22010000000000000" })).toThrow("FRESH_EXIT_QUOTE_REQUIRED");
    session = { ...session, recovery: { ...session.recovery!, state: "EXIT_CONFIRMED" } };
    session = recordRecoveredUsdt(session, settlement(quote.inputRaw, quote.outputRaw, USDT_ADDRESS));
    expect(session.recovery).toMatchObject({ state: "ACTUAL_USDT_RECOVERED", recoveryState: "RECOVERED_AS_USDT",
      exitSettlement: { actualAmountOutRaw: quote.outputRaw } });
  });
  it("describes recoverable assets without promising principal", () => {
    expect(recoveryAfterProductStop({ ...base(), stage: "PARTIAL_ROUTE_STOPPED", leg1Settlement: { actualAmountOutRaw: "5" } } as ExecutionSession)).toBe("RECOVERABLE_AS_USDT");
    expect(recoveryAfterProductStop({ ...base(), leg2Settlement: { actualAmountOutRaw: "4" } } as ExecutionSession)).toBe("RECOVERABLE_AS_NVDAB");
    expect(JSON.stringify(beginVenusRecovery(base(), position))).not.toMatch(/guarantee|principal/i);
  });
});
