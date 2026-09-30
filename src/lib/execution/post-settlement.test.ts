import { beforeEach, describe, expect, it, vi } from "vitest";
import { NVDAB_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import { encodeExactApproval, reviewApproval } from "@/domain/authorization/approval";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), persist: vi.fn(), leg2: vi.fn(), venus: vi.fn(), review: vi.fn(), simulate: vi.fn(), evidence: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pool", () => ({ executionPool: () => ({ query: mocks.evidence }) }));
vi.mock("./repository", () => ({ getExecutionRoute: mocks.get, saveExecutionRoute: mocks.save, persistPreparedReview: mocks.persist }));
vi.mock("./prepare", () => ({ prepareLeg2FromMeasured: mocks.leg2, prepareVenusFromMeasured: mocks.venus }));
vi.mock("./review", () => ({ createServerReview: mocks.review }));
vi.mock("@/lib/binance/simulation", () => ({ simulateEvmTransaction: mocks.simulate }));
vi.mock("@/domain/execution/lifecycle", async original => ({ ...(await original<typeof import("@/domain/execution/lifecycle")>()),
  prepareReview: (session: object, review: { boundary: string }) => ({ ...session, stage: review.boundary === "CHANGE_REPRESENTATION" ? "LEG2_REVIEW" : "VENUS_REVIEW" }) }));
import { prepareDurableLeg2Review, prepareDurableVenusReview } from "./post-settlement";

const routeId = "11111111-1111-4111-8111-111111111111", wallet = "0x1111111111111111111111111111111111111111" as const;
const market = "0xEb8Ca841cBe1BC4832A10b15c7dAB1081eDaD371" as const;
const txHash = `0x${"a".repeat(64)}`;
const actualUsdt = "199000000000000000000", actualNvdab = "998000000000000000";
const settlement = (amount: string) => ({ transactionHash: txHash, blockNumber: "123", actualAmountOutRaw: amount });
const swap = { kind: "SWAP" as const, chainId: 56 as const, from: wallet, to: market, rawCalldata: "0x12345678",
  valueWei: "0", tokenIn: USDT_ADDRESS, tokenOut: NVDAB_ADDRESS, amountInRaw: actualUsdt, simulation: { status: "PASSED" } };

describe("durable post-settlement review orchestration", () => {
  beforeEach(() => { Object.values(mocks).forEach(mock => mock.mockReset()); mocks.evidence.mockResolvedValue({ rowCount: 1,
    rows: [{ tx_hash: txHash, block_number: "123", amount_out_raw: actualUsdt, evidence_source: "BSC_CANONICAL_RPC" }] });
    mocks.persist.mockResolvedValue({ id: "step" }); mocks.save.mockResolvedValue(1); mocks.simulate.mockResolvedValue({ status: "PASSED" }); });
  it("persists a fresh leg-2 review from actual canonical USDT and refuses mismatched evidence", async () => {
    const session = { id: routeId, owner: wallet, stage: "ACTUAL_USDT_MEASURED", leg1Settlement: settlement(actualUsdt) };
    mocks.get.mockResolvedValue({ session, state: session.stage, version: 7 });
    mocks.leg2.mockResolvedValue({ session: { ...session, stage: "POLICY_RECHECKED", freshTarget: { address: NVDAB_ADDRESS }, freshLeg2: {
      quoteId: "new-quote", observedAt: "2026-09-30T00:00:00Z", expiresAt: null } },
      build: { evmTx: { from: wallet, to: market, value: "0", data: "0x12345678" }, actions: [swap] } });
    mocks.review.mockResolvedValue({ boundary: "CHANGE_REPRESENTATION", allowanceSufficient: true });
    const result = await prepareDurableLeg2Review(routeId,wallet);
    expect(result).toMatchObject({ state: "LEG2_REVIEW", amountInRaw: actualUsdt });
    expect(mocks.persist.mock.calls[0][2]).toBe(7);
    expect(mocks.persist.mock.calls[0][4]).toMatchObject({ stage: "LEG2_SWAP", amountInRaw: actualUsdt, planIdentity: "new-quote" });
    mocks.evidence.mockResolvedValueOnce({ rowCount: 1, rows: [{ tx_hash: txHash, block_number: "123", amount_out_raw: "1", evidence_source: "BSC_CANONICAL_RPC" }] });
    await expect(prepareDurableLeg2Review(routeId,wallet)).rejects.toThrow("CANONICAL_SETTLEMENT_REQUIRED");
  });
  it("durably stops when the fresh policy fails; no leg-2 action is persisted", async () => {
    const session = { id: routeId, owner: wallet, stage: "ACTUAL_USDT_MEASURED", leg1Settlement: settlement(actualUsdt) };
    mocks.get.mockResolvedValue({ session, state: session.stage, version: 7 });
    mocks.leg2.mockResolvedValue({ session: { ...session, stage: "PARTIAL_ROUTE_STOPPED" }, build: null });
    expect(await prepareDurableLeg2Review(routeId,wallet)).toMatchObject({ state: "PARTIAL_ROUTE_STOPPED", amountRemainingRaw: actualUsdt });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("uses actual canonical NVDAB for a fresh bounded Venus approval review", async () => {
    const session = { id: routeId, owner: wallet, stage: "ACTUAL_NVDAB_MEASURED", leg2Settlement: settlement(actualNvdab) };
    mocks.get.mockResolvedValue({ session, state: session.stage, version: 9 });
    mocks.evidence.mockResolvedValue({ rowCount: 1, rows: [{ tx_hash: txHash, block_number: "123", amount_out_raw: actualNvdab, evidence_source: "BSC_CANONICAL_RPC" }] });
    const authorization = reviewApproval({ token: NVDAB_ADDRESS, spender: market, requestedAmountRaw: actualNvdab,
      allowedAmountRaw: actualNvdab, decimals: 18, source: "EQUITYRELAY_BOUNDED_REPLACEMENT" });
    const approval = { kind: "APPROVAL" as const, chainId: 56 as const, from: wallet, to: NVDAB_ADDRESS,
      rawCalldata: encodeExactApproval(market,actualNvdab), valueWei: "0", tokenIn: NVDAB_ADDRESS, tokenOut: null,
      amountInRaw: actualNvdab, authorization };
    const deposit = { kind: "DEPOSIT" as const, chainId: 56 as const, from: wallet, to: market,
      rawCalldata: "0x12345678", valueWei: "0", tokenIn: NVDAB_ADDRESS, tokenOut: null, amountInRaw: actualNvdab };
    mocks.venus.mockResolvedValue({ session: { ...session, stage: "VENUS_REDISCOVERED", venus: { investmentId: "fresh-venus" } },
      deposit: { actions: [approval,deposit] } });
    mocks.review.mockResolvedValue({ boundary: "SUPPLY_TO_VENUS", allowanceSufficient: false, approval: authorization });
    const result = await prepareDurableVenusReview(routeId,wallet);
    expect(result).toMatchObject({ state: "VENUS_REVIEW", amountInRaw: actualNvdab, stage: "VENUS_APPROVAL" });
    expect(mocks.persist.mock.calls[0][4]).toMatchObject({ kind: "APPROVAL", approvalAmountRaw: actualNvdab,
      approvalSpender: market.toLowerCase(), planIdentity: "fresh-venus" });
  });
});
