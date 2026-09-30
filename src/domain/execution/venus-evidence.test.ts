import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, parseAbiParameters, type Hex } from "viem";
import fixture from "./fixtures/venus-nvdab-mint-mainnet.json";
import { NVDAB_ADDRESS, VENUS_VNVDAB_ADDRESS } from "@/domain/routing/identity";
import { inspectVenusSupply, venusSupplyAbi, type VenusReceiptLog } from "./venus-evidence";
import type { Address } from "@/types/route";

function fixtureInput() {
  return {
    chainId: fixture.chainId,
    transactionHash: fixture.transaction.hash as Hex,
    transactionFrom: fixture.transaction.from as Address,
    transactionTo: fixture.transaction.to as Address,
    transactionValueRaw: fixture.transaction.value,
    calldata: fixture.transaction.input as Hex,
    receiptStatus: fixture.receipt.status as "success",
    receiptTo: fixture.receipt.to as Address,
    blockNumber: fixture.receipt.blockNumber,
    expectedWallet: fixture.transaction.from as Address,
    expectedAmountRaw: "1099946467462607788",
    marketIdentity: {
      market: fixture.marketIdentity.market as Address,
      underlying: fixture.marketIdentity.underlying as Address,
      symbol: fixture.marketIdentity.symbol,
      implementation: fixture.marketIdentity.implementationObservedAtValidation as Address,
    },
    logs: fixture.receipt.logs as VenusReceiptLog[],
    position: { ...fixture.position, accountSnapshotAfter: fixture.position.accountSnapshotAfter as [string, string, string, string] },
  };
}

describe("Venus historical mainnet verifier fixture", () => {
  it("verifies the canonical direct-mint evidence and resulting position", () => {
    expect(fixture.fixtureType).toBe("HISTORICAL MAINNET VERIFIER FIXTURE");
    expect(inspectVenusSupply(fixtureInput())).toEqual({ status: "VERIFIED", evidence: {
      transactionHash: fixture.transaction.hash,
      blockNumber: "124836339",
      market: VENUS_VNVDAB_ADDRESS,
      underlying: NVDAB_ADDRESS,
      supplier: fixture.transaction.from,
      receiver: fixture.transaction.from,
      underlyingAmountRaw: "1099946467462607788",
      vTokensMintedRaw: "109994646",
      eventType: "Mint",
      eventAccountBalanceRaw: "109994646",
      resultingVTokenBalanceRaw: "109994646",
    } });
  });

  it.each([
    ["failed receipt", (x: ReturnType<typeof fixtureInput>) => ({ ...x, receiptStatus: "reverted" as const }), "VENUS_RECEIPT_FAILED"],
    ["wrong market", (x: ReturnType<typeof fixtureInput>) => ({ ...x, transactionTo: NVDAB_ADDRESS }), "VENUS_MARKET_MISMATCH"],
    ["wrong underlying", (x: ReturnType<typeof fixtureInput>) => ({ ...x, marketIdentity: { ...x.marketIdentity, underlying: VENUS_VNVDAB_ADDRESS } }), "VENUS_UNDERLYING_MISMATCH"],
    ["wrong supplier", (x: ReturnType<typeof fixtureInput>) => ({ ...x, expectedWallet: "0x1111111111111111111111111111111111111111" as Address }), "VENUS_TRANSACTION_SEMANTICS_MISMATCH"],
    ["missing event", (x: ReturnType<typeof fixtureInput>) => ({ ...x, logs: x.logs.filter(log => log.topics[0] !== "0xb4c03061fb5b7fed76389d5af8f2e0ddb09f8c70d1333abbb62582835e10accb") }), "VENUS_SUPPLY_EVENT_MISSING_OR_AMBIGUOUS"],
    ["ambiguous deposits", (x: ReturnType<typeof fixtureInput>) => ({ ...x, logs: [...x.logs, x.logs[1]] }), "VENUS_SUPPLY_EVENT_MISSING_OR_AMBIGUOUS"],
    ["malformed event", (x: ReturnType<typeof fixtureInput>) => ({ ...x, logs: x.logs.map((log, index) => index === 1 ? { ...log, data: "0x12" as Hex } : log) }), "VENUS_SUPPLY_EVENT_MISSING_OR_AMBIGUOUS"],
    ["missing position", (x: ReturnType<typeof fixtureInput>) => ({ ...x, position: { ...x.position, receiverVTokenBalanceAfterRaw: "0" } }), "VENUS_POSITION_EVIDENCE_MISMATCH"],
  ])("fails closed for %s", (_label, change, reason) => {
    expect(inspectVenusSupply(change(fixtureInput()))).toEqual({ status: "REJECTED", reason });
  });
});

describe("Venus MintBehalf path", () => {
  it("decodes payer and receiver but refuses a redirected EquityRelay position", () => {
    const input = fixtureInput();
    const receiver = "0x2222222222222222222222222222222222222222" as Address;
    const amount = 5n, tokens = 2n;
    const calldata = encodeFunctionData({ abi: venusSupplyAbi, functionName: "mintBehalf", args: [receiver, amount] });
    const event: VenusReceiptLog = { address: VENUS_VNVDAB_ADDRESS,
      topics: encodeEventTopics({ abi: venusSupplyAbi, eventName: "MintBehalf" }) as Hex[],
      data: encodeAbiParameters(parseAbiParameters("address,address,uint256,uint256,uint256"), [input.expectedWallet, receiver, amount, tokens, tokens]) };
    const underlying: VenusReceiptLog = { address: NVDAB_ADDRESS,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: input.expectedWallet, to: VENUS_VNVDAB_ADDRESS } }) as Hex[],
      data: encodeAbiParameters(parseAbiParameters("uint256"), [amount]) };
    const minted: VenusReceiptLog = { address: VENUS_VNVDAB_ADDRESS,
      topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: VENUS_VNVDAB_ADDRESS, to: receiver } }) as Hex[],
      data: encodeAbiParameters(parseAbiParameters("uint256"), [tokens]) };
    expect(inspectVenusSupply({ ...input, calldata, expectedAmountRaw: "5", logs: [underlying, event, minted] })).toEqual({
      status: "REJECTED", reason: "VENUS_RECEIVER_MISMATCH",
    });
  });
});
