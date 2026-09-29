import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
vi.mock("server-only", () => ({}));

import { buildSwapTransaction } from "./swap-build";
import { simulateEvmTransaction } from "./simulation";
import { buildVenusDeposit } from "./defi-transaction";
import { BrowserIntentSchema } from "@/lib/intent";
import { NVDAON_ADDRESS, NVDAB_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import type { QuoteSnapshot } from "@/types/route";

const owner = "0x1111111111111111111111111111111111111111" as const;
const router = "0x2222222222222222222222222222222222222222" as const;
const spender = "0x3333333333333333333333333333333333333333" as const;
const approveData = (amount: bigint) => `0x095ea7b3${spender.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;
const quote = (): QuoteSnapshot => ({ leg: 1, from: NVDAON_ADDRESS, to: USDT_ADDRESS, inputRaw: "100", outputRaw: "99", quoteId: "fresh-id", vendor: "vendor", tradeFeeUsd: null, priceImpactPercent: null, observedAt: new Date().toISOString(), expiresAt: null });
const destination = { protocol: "Venus" as const, chainId: 56 as const, investmentId: "live-id", assetAddress: NVDAB_ADDRESS, investable: true, observedAt: new Date().toISOString() };
const target = { chainId: 56 as const, underlying: "NVDA" as const, issuer: "bstock" as const, symbol: "NVDAB" as const, address: NVDAB_ADDRESS, decimals: 18, tokenToShareRatio: "1", open: true, observedAt: new Date().toISOString() };
const envelope = (data: unknown) => ({ code: 0, success: true, data });
function queue(...responses: Array<{ code?: number; msg?: string; data?: unknown; success?: boolean }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected request");
    return new Response(JSON.stringify(next), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}
beforeEach(() => { process.env.BINANCE_W3_API_KEY = "test-key"; process.env.BINANCE_W3_API_SECRET = "test-secret"; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.BINANCE_W3_API_KEY; delete process.env.BINANCE_W3_API_SECRET; });

describe("read-only transaction builders", () => {
  it("builds and validates a SWAP with a bounded approval and no native value", async () => {
    const calls = queue(envelope({ executionMode: "SWAP", routerResult: { binanceChainId: "56", fromTokenAmount: "100", toTokenAmount: "99", fromToken: { tokenContractAddress: NVDAON_ADDRESS }, toToken: { tokenContractAddress: USDT_ADDRESS } }, tx: { from: owner, to: router, data: "0x12345678", value: "0", gas: "450000", minReceiveAmount: "98", signatureData: [JSON.stringify({ approveContract: spender, approveTxCalldata: approveData(100n) })] } }));
    const result = await buildSwapTransaction(quote(), owner, "0.2");
    expect(result.executionMode).toBe("SWAP");
    expect(result.actions.map(x => x.kind)).toEqual(["APPROVAL", "SWAP"]);
    expect(result.actions[1]).toMatchObject({ to: router, minAmountOutRaw: "98", valueWei: "0" });
    expect(calls[0].url).toContain("/build/api/v1/dex/aggregator/swap?");
    expect(calls[0].url).toContain("quoteId=fresh-id");
    expect(calls[0].url).toContain("approveAmount=100");
    expect(calls[0].url).toContain("slippagePercent=0.2");
  });
  it("keeps RFQ as typed-data signing, without inventing EVM calldata", async () => {
    queue(envelope({ executionMode: "RFQ", routerResult: { binanceChainId: "56", fromTokenAmount: "100", toTokenAmount: "99", fromToken: { tokenContractAddress: NVDAON_ADDRESS }, toToken: { tokenContractAddress: USDT_ADDRESS } }, rfq: { txType: "EIP712", typedDataToSign: "0x1234", vendor: "Vendor" } }));
    const result = await buildSwapTransaction(quote(), owner, "0.2");
    expect(result.evmTx).toBeNull();
    expect(result.actions.at(-1)).toMatchObject({ kind: "RFQ", to: null, simulation: { status: "UNAVAILABLE" } });
  });
  it("rejects a swap transaction with wrong sender or unexpected native value", async () => {
    const route = { binanceChainId: "56", fromTokenAmount: "100", toTokenAmount: "99", fromToken: { tokenContractAddress: NVDAON_ADDRESS }, toToken: { tokenContractAddress: USDT_ADDRESS } };
    queue(envelope({ executionMode: "SWAP", routerResult: route, tx: { from: router, to: router, data: "0x12345678", value: "0", minReceiveAmount: "98" } }));
    await expect(buildSwapTransaction(quote(), owner, "0.2")).rejects.toThrow("INVALID_TRANSACTION_ADDRESS");
    vi.unstubAllGlobals();
    queue(envelope({ executionMode: "SWAP", routerResult: route, tx: { from: owner, to: router, data: "0x12345678", value: "1", minReceiveAmount: "98" } }));
    await expect(buildSwapTransaction(quote(), owner, "0.2")).rejects.toThrow("UNEXPECTED_NATIVE_VALUE");
  });
  it("rejects build route identity changes and slippage above the policy-derived cap", async () => {
    const route = { binanceChainId: "56", fromTokenAmount: "100", toTokenAmount: "99", fromToken: { tokenContractAddress: NVDAON_ADDRESS }, toToken: { tokenContractAddress: USDT_ADDRESS } };
    queue(envelope({ executionMode: "SWAP", routerResult: { ...route, toToken: { tokenContractAddress: NVDAB_ADDRESS } }, tx: { from: owner, to: router, data: "0x12345678", value: "0", minReceiveAmount: "98" } }));
    await expect(buildSwapTransaction(quote(), owner, "0.2")).rejects.toThrow("BUILD_ROUTE_IDENTITY_MISMATCH");
    vi.unstubAllGlobals();
    queue(envelope({ executionMode: "SWAP", routerResult: route, tx: { from: owner, to: router, data: "0x12345678", value: "0", minReceiveAmount: "98", slippagePercent: "0.3" } }));
    await expect(buildSwapTransaction(quote(), owner, "0.2")).rejects.toThrow("BUILD_SLIPPAGE_EXCEEDS_POLICY");
  });
  it("sends only evmTx to the simulation API and rejects business errors", async () => {
    const calls = queue(envelope({ status: "SUCCESS", balanceChanges: [], allowanceChanges: [] }));
    expect((await simulateEvmTransaction({ from: owner, to: router, value: "0", data: "0x12345678" })).status).toBe("PASSED");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toEqual({ binanceChainId: "56", evmTx: { from: owner, to: router, value: "0", data: "0x12345678" } });
    vi.unstubAllGlobals();
    queue({ code: 40304, msg: "Service unavailable" });
    expect((await simulateEvmTransaction({ from: owner, to: router, value: "0", data: "0x12345678" })).status).toBe("UNAVAILABLE");
  });
  it("preserves ordered Venus APPROVE then DEPOSIT, hex value, decimal gas and warnings", async () => {
    const calls = queue(envelope({ dataList: [
      { callDataType: "APPROVE", from: owner, to: NVDAB_ADDRESS, value: "0x0", data: approveData(100n), gasLimit: "74142", maxFeePerGas: "57014496" },
      { callDataType: "DEPOSIT", from: owner, to: router, value: "0x0", data: "0x12345678", gasLimit: "150000", maxFeePerGas: "57014496" },
    ], preview: { success: true, balanceChange: [{ tokenSymbol: "NVDAB", amount: "-0.0000000000000001" }], feeAndContract: { estimatedNetworkFee: { amount: "0.0001", tokenSymbol: "BNB" } }, healthFactor: { before: "2", after: "2.1" }, warnings: [{ code: "HEALTH_FACTOR_WARNING", message: "Watch risk" }] } }));
    const result = await buildVenusDeposit(owner, destination, target, "100");
    expect(result.actions.map(x => x.kind)).toEqual(["APPROVAL", "DEPOSIT"]);
    expect(result.actions[0]).toMatchObject({ valueWei: "0", gasLimit: "74142", maxFeePerGas: "57014496", approvalSpender: spender });
    expect(result.simulationStatus).toBe("PASSED");
    expect(result.previewDetails?.estimatedNetworkFee).toBe("0.0001 BNB");
    expect(result.actions[0].simulation.warnings).toContain("HEALTH_FACTOR_WARNING · Watch risk");
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ investmentId: "live-id", simulate: true, token: { tokenAddress: NVDAB_ADDRESS } });
  });
  it("retries build-only after an explicit wallet-balance simulation error without inventing success", async () => {
    const calls = queue({ code: 40484, msg: "Insufficient balance. Please check your available funds and try again." }, envelope({ dataList: [
      { callDataType: "APPROVE", from: owner, to: NVDAB_ADDRESS, value: "0x0", data: approveData(2n ** 256n - 1n), gasLimit: "74142" },
      { callDataType: "DEPOSIT", from: owner, to: router, value: "0x0", data: "0x12345678" },
    ] }));
    const result = await buildVenusDeposit(owner, destination, target, "100");
    expect(result.buildStatus).toBe("READY");
    expect(result.simulationStatus).toBe("BLOCKED_BY_WALLET_STATE");
    expect(result.actions[0].approvalExceedsInput).toBe(true);
    expect(JSON.parse(calls[1].init.body as string).simulate).toBe(false);
  });
  it("does not build a deposit for a non-investable destination", async () => {
    queue();
    await expect(buildVenusDeposit(owner, { ...destination, investable: false }, target, "100")).rejects.toThrow("VENUS_DESTINATION_UNAVAILABLE");
  });
  it("rejects browser-supplied addresses, investment IDs and calldata", () => {
    const intent = { underlying: "NVDA", sourceRepresentation: "ondo", amount: "0.05", destination: "venus", maxExposureLossBps: 50, takerAddress: owner };
    expect(BrowserIntentSchema.safeParse(intent).success).toBe(true);
    for (const extra of [{ tokenAddress: NVDAON_ADDRESS }, { investmentId: "injected" }, { calldata: "0x1234" }]) {
      expect(BrowserIntentSchema.safeParse({ ...intent, ...extra }).success).toBe(false);
    }
  });
});

describe("Phase 2A surface boundary", () => {
  it("exposes only preview and preflight API routes and contains no wallet signing or broadcast implementation", () => {
    const apiRoot = join(process.cwd(), "src/app/api/route");
    expect(readdirSync(apiRoot).sort()).toEqual(["preflight", "preview"]);
    for (const path of ["src/lib/binance", "src/app/api/route"]) {
      const entries = readdirSync(join(process.cwd(), path), { recursive: true });
      for (const entry of entries) {
        if (typeof entry !== "string" || !entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
        const source = readFileSync(join(process.cwd(), path, entry), "utf8");
        expect(source).not.toMatch(/\b(?:privateKey|seedPhrase|signTransaction|sendRawTransaction|broadcastTransaction)\b/);
      }
    }
  });
});
