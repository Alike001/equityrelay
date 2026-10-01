import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));

import { buildPreview } from "./preview";
import { signedRequest } from "./client";
import { NVDAON_ADDRESS, NVDAB_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import { equityConfig, type SupportedUnderlying } from "@/domain/equities/registry";
import type { BrowserIntent } from "@/types/route";

const intent: BrowserIntent = { underlying: "NVDA", sourceRepresentation: "ondo", amount: "1", destination: "venus", maxExposureLossBps: 50, takerAddress: "0x1111111111111111111111111111111111111111" };
const rows = [
  { binanceChainId: "56", underlyingTicker: "NVDA", platformId: "ondo", tokenSymbol: "NVDAon", tokenContractAddress: NVDAON_ADDRESS, decimals: "18", tokenToShareRatio: "1.0017152487959898", statusInfo: { openState: true } },
  { binanceChainId: "56", underlyingTicker: "NVDA", platformId: "bstock", tokenSymbol: "NVDAB", tokenContractAddress: NVDAB_ADDRESS, decimals: "18", tokenToShareRatio: "1.000778223752807865", statusInfo: { openState: true } },
];
const first = { fromTokenAmount: "1000000000000000000", toTokenAmount: "200000000000000000000", vendorName: "Test vendor" };
const second = { fromTokenAmount: "200000000000000000000", toTokenAmount: "999000000000000000", vendorName: "Test vendor" };
const investment = { investmentId: "live-id", protocolName: "Venus", binanceChainId: "56", investable: true, assetTokenList: [{ tokenAddress: NVDAB_ADDRESS, tokenSymbol: "NVDAB" }] };
function liveRows(underlying: SupportedUnderlying, sourceRatio = "1", targetRatio = "1") {
  const config = equityConfig(underlying);
  return [
    { binanceChainId: "56", underlyingTicker: underlying, platformId: "ondo", tokenSymbol: config.sourceSymbol, tokenContractAddress: config.sourceAddress, decimals: "18", tokenToShareRatio: sourceRatio, statusInfo: { openState: true } },
    { binanceChainId: "56", underlyingTicker: underlying, platformId: "bstock", tokenSymbol: config.targetSymbol, tokenContractAddress: config.targetAddress, decimals: "18", tokenToShareRatio: targetRatio, statusInfo: { openState: true } },
  ];
}
function venus(underlying: SupportedUnderlying, investable = true) {
  const config = equityConfig(underlying);
  return { investmentId: `live-${underlying}`, protocolName: "Venus", binanceChainId: "56", investable,
    assetTokenList: [{ tokenAddress: config.targetAddress, tokenSymbol: config.targetSymbol }] };
}
type MockReply = { code?: number; msg?: string; data?: unknown };
function reply(data: unknown): MockReply { return { code: 0, data }; }
function queue(...responses: MockReply[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const mock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected request");
    return new Response(JSON.stringify(next), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

beforeEach(() => { process.env.BINANCE_W3_API_KEY = "test-key"; process.env.BINANCE_W3_API_SECRET = "test-secret"; vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.BINANCE_W3_API_KEY; delete process.env.BINANCE_W3_API_SECRET; });

describe("signed Binance boundary", () => {
  it("signs the exact /build path and handles a successful envelope", async () => {
    const calls = queue(reply([]));
    await signedRequest("GET", "/api/v1/dex/market/rwa/tokens", { params: { binanceChainId: "56" } });
    expect(calls[0].url).toBe("https://web3.binance.com/build/api/v1/dex/market/rwa/tokens?binanceChainId=56");
    const headers = calls[0].init.headers as Record<string, string>;
    const expected = createHmac("sha256", "test-secret").update(`${headers["X-OC-TIMESTAMP"]}GET/build/api/v1/dex/market/rwa/tokens?binanceChainId=56`, "utf8").digest("base64");
    expect(headers["X-OC-SIGN"]).toBe(expected);
  });
  it("rejects HTTP 200 with a nonzero business code", async () => {
    queue({ code: 40368, msg: "Ondo asset on chain 56 can only pair with allowed stablecoin(s)" });
    await expect(signedRequest("GET", "/api/v1/dex/aggregator/quote")).rejects.toMatchObject({ businessCode: "40368", status: 200 });
  });
});

describe("live preview orchestration with controlled API responses", () => {
  it("uses exact leg 1 output as leg 2 raw input, then returns PASS", async () => {
    const calls = queue(reply(rows), reply([first]), reply([second]), reply({ list: [{ investmentId: "live-id", protocolName: "Venus" }] }), reply(investment));
    const result = await buildPreview(intent);
    expect(result.state).toBe("PASS");
    expect(calls[2].url).toContain(`amount=${first.toTokenAmount}`);
    expect(calls[2].url).toContain(`fromTokenAddress=${encodeURIComponent(USDT_ADDRESS)}`);
    expect(calls[2].url).toContain(`toTokenAddress=${encodeURIComponent(NVDAB_ADDRESS)}`);
  });
  it.each(["SPCX", "TSLA"] as const)("builds a live %s preview from its own allowlisted identities", async underlying => {
    const config = equityConfig(underlying);
    const assetIntent: BrowserIntent = { ...intent, underlying };
    const calls = queue(reply(liveRows(underlying, "1.01", "1")), reply([first]), reply([second]),
      reply({ list: [{ investmentId: `live-${underlying}`, protocolName: "Venus" }] }), reply(venus(underlying)));
    const result = await buildPreview(assetIntent);
    expect(result).toMatchObject({ kind: "decision", underlying, displayName: config.displayName, executionVerifierStatus: "NOT_VALIDATED" });
    expect(calls[2].url).toContain(`toTokenAddress=${encodeURIComponent(config.targetAddress)}`);
  });
  it("normalizes each asset with its live source and target ratios", async () => {
    queue(reply(liveRows("SPCX", "2", "4")), reply([first]), reply([second]),
      reply({ list: [{ investmentId: "live-SPCX", protocolName: "Venus" }] }), reply(venus("SPCX")));
    const result = await buildPreview({ ...intent, underlying: "SPCX" });
    expect(result.kind).toBe("decision");
    if (result.kind === "decision") {
      expect(result.sourceShares).toBe("2");
      expect(result.targetShares).toBe("3.996");
    }
  });
  it("fails closed when a supported asset live identity conflicts with the registry", async () => {
    const spcxRows = liveRows("SPCX");
    queue(reply([{ ...spcxRows[0], tokenSymbol: "WRONG" }, spcxRows[1]]));
    expect((await buildPreview({ ...intent, underlying: "SPCX" })).reasons).toEqual(["INVALID_EVIDENCE"]);
  });
  it("returns BLOCKED for a strict exposure policy", async () => {
    queue(reply(rows), reply([first]), reply([second]), reply({ list: [{ investmentId: "live-id", protocolName: "Venus" }] }), reply(investment));
    const result = await buildPreview({ ...intent, maxExposureLossBps: 0 });
    expect(result.state).toBe("BLOCKED");
    expect(result.reasons).toContain("BLOCK_EXPOSURE_POLICY");
  });
  it("returns BLOCKED when Venus is missing or not investable", async () => {
    queue(reply(rows), reply([first]), reply([second]), reply({ list: [] }));
    expect((await buildPreview(intent)).reasons).toEqual(["BLOCK_DESTINATION_NOT_INVESTABLE"]);
    vi.unstubAllGlobals();
    queue(reply(rows), reply([first]), reply([second]), reply({ list: [{ investmentId: "live-id", protocolName: "Venus" }] }), reply({ ...investment, investable: false }));
    expect((await buildPreview(intent)).reasons).toContain("BLOCK_DESTINATION_NOT_INVESTABLE");
  });
  it("returns UNAVAILABLE if leg 1 succeeded but leg 2 API failed", async () => {
    queue(reply(rows), reply([first]), { code: 40304, msg: "Service not available" });
    const result = await buildPreview(intent);
    expect(result).toMatchObject({ state: "UNAVAILABLE", reasons: ["UNAVAILABLE_API"] });
  });
  it("rejects malformed quote output and mismatched live identity", async () => {
    queue(reply(rows), reply([{ ...first, toTokenAmount: "bad" }]));
    expect((await buildPreview(intent)).reasons).toEqual(["INVALID_EVIDENCE"]);
    vi.unstubAllGlobals();
    queue(reply([{ ...rows[0], tokenContractAddress: NVDAB_ADDRESS }, rows[1]]));
    expect((await buildPreview(intent)).reasons).toEqual(["INVALID_EVIDENCE"]);
  });
  it("blocks an empty quote response without inventing a fill", async () => {
    queue(reply(rows), reply([]));
    expect((await buildPreview(intent)).reasons).toEqual(["BLOCK_NO_LEG1_QUOTE"]);
  });
});
