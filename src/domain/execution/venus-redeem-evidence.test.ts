import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, parseAbiParameters, type Hex } from "viem";
import { NVDAB_ADDRESS, VENUS_VNVDAB_ADDRESS } from "@/domain/routing/identity";
import type { Address } from "@/types/route";
import { inspectVenusRedeem, venusRedeemAbi, type VenusReceiptLog } from "./venus-evidence";

const wallet = "0x1111111111111111111111111111111111111111" as Address;
const hash = `0x${"1".repeat(64)}` as Hex;
const tokens = 2_200_000n, underlying = 22_000_000_000_000_000n;
function input() {
  const event: VenusReceiptLog = { address: VENUS_VNVDAB_ADDRESS,
    topics: encodeEventTopics({ abi: venusRedeemAbi, eventName: "Redeem" }) as Hex[],
    data: encodeAbiParameters(parseAbiParameters("address,uint256,uint256,uint256"), [wallet, underlying, tokens, 100n]) };
  const transfer: VenusReceiptLog = { address: NVDAB_ADDRESS,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: VENUS_VNVDAB_ADDRESS, to: wallet } }) as Hex[],
    data: encodeAbiParameters(parseAbiParameters("uint256"), [underlying]) };
  return { transactionHash: hash, blockNumber: "101", transactionFrom: wallet, transactionTo: VENUS_VNVDAB_ADDRESS,
    transactionValueRaw: "0", calldata: encodeFunctionData({ abi: venusRedeemAbi, functionName: "redeem", args: [tokens] }),
    expectedWallet: wallet, expectedVTokensRaw: tokens.toString(), logs: [event, transfer],
    position: { beforeBlock: "100", afterBlock: "101", vTokenBalanceBeforeRaw: (tokens + 100n).toString(), vTokenBalanceAfterRaw: "100",
      accountSnapshotAfter: ["0", "100", "0", "0"] as [string,string,string,string],
      marketUnderlyingBalanceBeforeRaw: (underlying + 50n).toString(), marketUnderlyingBalanceAfterRaw: "50" } };
}

describe("canonical Venus redemption evidence", () => {
  it("requires the Redeem event, exact NVDAB transfer and resulting position", () => {
    expect(inspectVenusRedeem(input())).toEqual({ status: "VERIFIED", evidence: { transactionHash: hash, blockNumber: "101",
      market: VENUS_VNVDAB_ADDRESS, underlying: NVDAB_ADDRESS, redeemer: wallet,
      vTokensRedeemedRaw: tokens.toString(), underlyingReceivedRaw: underlying.toString(), resultingVTokenBalanceRaw: "100" } });
  });
  it.each([
    ["wrong wallet", { expectedWallet: "0x2222222222222222222222222222222222222222" }, "VENUS_REDEEMER_MISMATCH"],
    ["quoted amount", { expectedVTokensRaw: (tokens - 1n).toString() }, "VENUS_REDEEM_AMOUNT_MISMATCH"],
    ["missing event", { logs: input().logs.slice(1) }, "VENUS_REDEEM_EVENT_MISSING_OR_AMBIGUOUS"],
    ["ambiguous event", { logs: [input().logs[0], input().logs[0], input().logs[1]] }, "VENUS_REDEEM_EVENT_MISSING_OR_AMBIGUOUS"],
    ["missing transfer", { logs: input().logs.slice(0, 1) }, "VENUS_REDEEM_TRANSFER_MISSING_OR_AMBIGUOUS"],
    ["position mismatch", { position: { ...input().position, vTokenBalanceAfterRaw: "101" } }, "VENUS_REDEEM_POSITION_EVIDENCE_MISMATCH"],
  ])("fails closed for %s", (_label, override, reason) => {
    expect(inspectVenusRedeem({ ...input(), ...override } as ReturnType<typeof input>)).toEqual({ status: "REJECTED", reason });
  });
});
