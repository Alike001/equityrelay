import { describe, expect, it } from "vitest";
import { decodeErc20Approval, encodeExactApproval, reviewApproval } from "./approval";
import { NVDAB_ADDRESS } from "@/domain/routing/identity";

const spender = "0x2222222222222222222222222222222222222222" as const;
const zero = "0x0000000000000000000000000000000000000000" as const;

describe("ERC-20 authorization ABI", () => {
  it("round trips the exact unsigned approval with decimal-safe human units", () => {
    const amountRaw = "49900937795210610";
    const calldata = encodeExactApproval(spender, amountRaw);
    expect(decodeErc20Approval(calldata)).toEqual({ spender, amountRaw });
    expect(reviewApproval({ token: NVDAB_ADDRESS, spender, requestedAmountRaw: amountRaw, allowedAmountRaw: amountRaw, decimals: 18, source: "EQUITYRELAY_BOUNDED_REPLACEMENT" })).toMatchObject({ status: "BOUNDED_READY", scope: "EXACT", requestedAmountHuman: "0.04990093779521061", allowedAmountHuman: "0.04990093779521061", reasonCodes: ["APPROVAL_EXACT_AMOUNT"] });
  });
  it("rejects malformed, wrong-selector, noncanonical, zero-spender and zero-amount calldata", () => {
    const valid = encodeExactApproval(spender, "100");
    for (const data of ["0x123", "0x12345678", `${valid}00`]) expect(() => decodeErc20Approval(data)).toThrow();
    expect(() => decodeErc20Approval(encodeExactApproval(spender, "100").replace("095ea7b3", "a9059cbb"))).toThrow("INVALID_APPROVAL_SELECTOR");
    const zeroSpender = `0x095ea7b3${"0".repeat(64)}${"1".padStart(64, "0")}`;
    expect(() => decodeErc20Approval(zeroSpender)).toThrow("ZERO_APPROVAL_SPENDER");
    expect(() => encodeExactApproval(zero, "100")).toThrow("ZERO_APPROVAL_SPENDER");
    expect(() => encodeExactApproval(spender, "0")).toThrow("INVALID_APPROVAL_AMOUNT");
  });
  it("rejects max uint256 and smaller-than-needed approval scopes", () => {
    const max = (2n ** 256n - 1n).toString();
    expect(reviewApproval({ token: NVDAB_ADDRESS, spender, requestedAmountRaw: max, allowedAmountRaw: "100", decimals: 18, source: "BINANCE" })).toMatchObject({ status: "BROAD_APPROVAL_REJECTED", scope: "BROAD", reasonCodes: ["BLOCK_AUTHORIZATION_SCOPE"] });
    expect(reviewApproval({ token: NVDAB_ADDRESS, spender, requestedAmountRaw: "99", allowedAmountRaw: "100", decimals: 18, source: "BINANCE" })).toMatchObject({ status: "INVALID_APPROVAL", scope: "INSUFFICIENT", reasonCodes: ["APPROVAL_BELOW_REQUIRED"] });
  });
});
