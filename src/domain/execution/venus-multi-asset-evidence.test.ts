import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import type { Address } from "@/types/route";
import { inspectVenusRedeem, inspectVenusSupply, type VenusReceiptLog } from "./venus-evidence";
import tslabMint from "./fixtures/venus-tslab-mint-mainnet.json";
import tslabRedeem from "./fixtures/venus-tslab-redeem-mainnet.json";
import spcxbMint from "./fixtures/venus-spcxb-mint-mainnet.json";
import spcxbRedeem from "./fixtures/venus-spcxb-redeem-mainnet.json";

const supplies = [
  { fixture: tslabMint, amount: "5743954073392145541", tokens: "574395351", balance: "574395351" },
  { fixture: spcxbMint, amount: "57869559570000000000", tokens: "5786954696", balance: "5786954697" },
] as const;

const redeems = [
  { fixture: tslabRedeem, tokens: "12887098", underlying: "128870992490150591", balance: "0" },
  { fixture: spcxbRedeem, tokens: "5786954696", underlying: "57869559560850385019", balance: "1" },
] as const;

function logs(fixture: { receipt: { logs: Array<{ address: string; data: string; topics: string[]; logIndex: number }> } }): VenusReceiptLog[] {
  return fixture.receipt.logs.map(log => ({ ...log, address: log.address as Address, data: log.data as Hex, topics: log.topics as Hex[] }));
}

describe("historical mainnet multi-equity Venus verifier fixtures", () => {
  it.each(supplies)("verifies $fixture.marketIdentity.symbol supply evidence", ({ fixture, amount, tokens, balance }) => {
    expect(fixture.fixtureType).toBe("HISTORICAL MAINNET VENUS SUPPLY FIXTURE");
    expect(fixture.receipt.status).toBe("success");
    expect(fixture.position.blockExactStatus).toBe("ARCHIVE_STATE_UNAVAILABLE");
    expect(inspectVenusSupply({
      chainId: 56, transactionHash: fixture.transaction.hash as Hex,
      transactionFrom: fixture.transaction.from as Address, transactionTo: fixture.transaction.to as Address,
      transactionValueRaw: fixture.transaction.value, calldata: fixture.transaction.input as Hex,
      receiptStatus: "success", receiptTo: fixture.receipt.to as Address, blockNumber: fixture.receipt.blockNumber,
      expectedWallet: fixture.transaction.from as Address, expectedAmountRaw: amount,
      marketIdentity: { market: fixture.marketIdentity.market as Address, underlying: fixture.marketIdentity.underlying as Address,
        symbol: fixture.marketIdentity.symbol, implementation: fixture.marketIdentity.implementationObservedAtValidation as Address },
      logs: logs(fixture),
    })).toEqual({ status: "VERIFIED", evidence: {
      transactionHash: fixture.transaction.hash, blockNumber: fixture.receipt.blockNumber,
      market: fixture.marketIdentity.market, underlying: fixture.marketIdentity.underlying,
      supplier: fixture.transaction.from, receiver: fixture.transaction.from,
      underlyingAmountRaw: amount, vTokensMintedRaw: tokens, eventType: "Mint",
      eventAccountBalanceRaw: balance, resultingVTokenBalanceRaw: balance,
    } });
  });

  it.each(redeems)("verifies $fixture.marketIdentity.symbol redemption evidence", ({ fixture, tokens, underlying, balance }) => {
    expect(fixture.fixtureType).toBe("HISTORICAL MAINNET VENUS REDEMPTION FIXTURE");
    expect(fixture.receipt.status).toBe("success");
    expect(fixture.position.blockExactStatus).toBe("ARCHIVE_STATE_UNAVAILABLE");
    expect(inspectVenusRedeem({ transactionHash: fixture.transaction.hash as Hex, blockNumber: fixture.receipt.blockNumber,
      transactionFrom: fixture.transaction.from as Address, transactionTo: fixture.transaction.to as Address,
      transactionValueRaw: fixture.transaction.value, calldata: fixture.transaction.input as Hex,
      expectedWallet: fixture.transaction.from as Address, expectedVTokensRaw: tokens, logs: logs(fixture) })).toEqual({
        status: "VERIFIED", evidence: { transactionHash: fixture.transaction.hash, blockNumber: fixture.receipt.blockNumber,
          market: fixture.marketIdentity.market, underlying: fixture.marketIdentity.underlying, redeemer: fixture.transaction.from,
          vTokensRedeemedRaw: tokens, underlyingReceivedRaw: underlying, resultingVTokenBalanceRaw: balance },
      });
  });

  it.each(supplies)("fails closed for $fixture.marketIdentity.symbol profile identity mismatch", ({ fixture, amount }) => {
    expect(inspectVenusSupply({ chainId: 56, transactionHash: fixture.transaction.hash as Hex,
      transactionFrom: fixture.transaction.from as Address, transactionTo: fixture.transaction.to as Address,
      transactionValueRaw: fixture.transaction.value, calldata: fixture.transaction.input as Hex,
      receiptStatus: "success", receiptTo: fixture.receipt.to as Address, blockNumber: fixture.receipt.blockNumber,
      expectedWallet: fixture.transaction.from as Address, expectedAmountRaw: amount,
      marketIdentity: { market: fixture.marketIdentity.market as Address,
        underlying: "0x1111111111111111111111111111111111111111" as Address,
        symbol: fixture.marketIdentity.symbol, implementation: fixture.marketIdentity.implementationObservedAtValidation as Address },
      logs: logs(fixture) })).toEqual({ status: "REJECTED", reason: "VENUS_UNDERLYING_MISMATCH" });
  });

  it.each(supplies)("fails closed for missing or wrong-wallet $fixture.marketIdentity.symbol supply evidence", ({ fixture, amount }) => {
    const base = { chainId: 56, transactionHash: fixture.transaction.hash as Hex,
      transactionFrom: fixture.transaction.from as Address, transactionTo: fixture.transaction.to as Address,
      transactionValueRaw: fixture.transaction.value, calldata: fixture.transaction.input as Hex,
      receiptStatus: "success" as const, receiptTo: fixture.receipt.to as Address, blockNumber: fixture.receipt.blockNumber,
      expectedWallet: fixture.transaction.from as Address, expectedAmountRaw: amount,
      marketIdentity: { market: fixture.marketIdentity.market as Address, underlying: fixture.marketIdentity.underlying as Address,
        symbol: fixture.marketIdentity.symbol, implementation: fixture.marketIdentity.implementationObservedAtValidation as Address },
      logs: logs(fixture) };
    expect(inspectVenusSupply({ ...base, logs: base.logs.filter(log => log.topics[0] !== "0xb4c03061fb5b7fed76389d5af8f2e0ddb09f8c70d1333abbb62582835e10accb") }))
      .toEqual({ status: "REJECTED", reason: "VENUS_SUPPLY_EVENT_MISSING_OR_AMBIGUOUS" });
    expect(inspectVenusSupply({ ...base, expectedWallet: "0x1111111111111111111111111111111111111111" as Address }))
      .toEqual({ status: "REJECTED", reason: "VENUS_TRANSACTION_SEMANTICS_MISMATCH" });
  });

  it.each(redeems)("fails closed for missing or wrong-wallet $fixture.marketIdentity.symbol redemption evidence", ({ fixture, tokens }) => {
    const base = { transactionHash: fixture.transaction.hash as Hex, blockNumber: fixture.receipt.blockNumber,
      transactionFrom: fixture.transaction.from as Address, transactionTo: fixture.transaction.to as Address,
      transactionValueRaw: fixture.transaction.value, calldata: fixture.transaction.input as Hex,
      expectedWallet: fixture.transaction.from as Address, expectedVTokensRaw: tokens, logs: logs(fixture) };
    expect(inspectVenusRedeem({ ...base, logs: base.logs.filter(log => log.topics[0] !== "0xbd5034ffbd47e4e72a94baa2cdb74c6fad73cb3bcdc13036b72ec8306f5a7646") }))
      .toEqual({ status: "REJECTED", reason: "VENUS_REDEEM_EVENT_MISSING_OR_AMBIGUOUS" });
    expect(inspectVenusRedeem({ ...base, expectedWallet: "0x1111111111111111111111111111111111111111" as Address }))
      .toEqual({ status: "REJECTED", reason: "VENUS_REDEEMER_MISMATCH" });
  });
});
