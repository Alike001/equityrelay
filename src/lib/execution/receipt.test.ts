import { describe, expect, it, vi } from "vitest";
import { USDT_ADDRESS, NVDAON_ADDRESS } from "@/domain/routing/identity";
import { deriveSettlement } from "@/domain/execution/settlement";

vi.mock("server-only", () => ({}));
import { parseConfirmedBinanceDetail } from "./receipt";

const owner = "0x1111111111111111111111111111111111111111" as const;
const target = "0x2222222222222222222222222222222222222222" as const;
const hash = `0x${"a".repeat(64)}` as `0x${string}`;
function detail(status = "success") { return [{ chainIndex: "56", height: "123", txTime: "1780000000000", txhash: hash, txStatus: status,
  fromDetails: [{ address: owner }], toDetails: [{ address: target }], tokenTransferDetails: [
    { from: owner, to: target, tokenContractAddress: NVDAON_ADDRESS, amount: "100" },
    { from: target, to: owner, tokenContractAddress: USDT_ADDRESS, amount: "200" },
  ] }]; }
describe("confirmed settlement evidence", () => {
  it("does not treat a hash or missing detail as confirmation", () => {
    expect(parseConfirmedBinanceDetail([], hash, owner, target)).toEqual({ status: "PENDING", transactionHash: hash });
    expect(parseConfirmedBinanceDetail(detail("pending"), hash, owner, target).status).toBe("PENDING");
    expect(parseConfirmedBinanceDetail(detail("failed"), hash, owner, target).status).toBe("FAILED");
  });
  it("derives actual amounts only from confirmed token transfers", () => {
    const observed = parseConfirmedBinanceDetail(detail(), hash, owner, target);
    expect(observed.status).toBe("CONFIRMED");
    if (observed.status !== "CONFIRMED") return;
    const settlement = deriveSettlement(observed, owner, NVDAON_ADDRESS, USDT_ADDRESS);
    expect(settlement).toMatchObject({ actualAmountInRaw: "100", actualAmountOutRaw: "200", blockNumber: "123" });
    expect(settlement.tokenTransfers[0].logIndex).toBeNull();
  });
  it("rejects mismatched sender, target, chain, and absent transfer", () => {
    expect(() => parseConfirmedBinanceDetail([{ ...detail()[0], chainIndex: "1" }], hash, owner, target)).toThrow("RECEIPT_IDENTITY_MISMATCH");
    expect(() => parseConfirmedBinanceDetail([{ ...detail()[0], toDetails: [{ address: owner }] }], hash, owner, target)).toThrow("RECEIPT_PARTIES_UNVERIFIED");
    const observed = parseConfirmedBinanceDetail([{ ...detail()[0], tokenTransferDetails: [] }], hash, owner, target);
    if (observed.status === "CONFIRMED") expect(() => deriveSettlement(observed, owner, NVDAON_ADDRESS, USDT_ADDRESS)).toThrow("SETTLEMENT_TRANSFER_MISSING");
  });
});
