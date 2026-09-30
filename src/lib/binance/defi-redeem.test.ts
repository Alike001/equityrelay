import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";
import { NVDAB_ADDRESS, VENUS_VNVDAB_ADDRESS } from "@/domain/routing/identity";

vi.mock("server-only", () => ({}));
vi.mock("./client", async importOriginal => {
  const original = await importOriginal<typeof import("./client")>();
  return { ...original, signedRequest: vi.fn() };
});
vi.mock("@/lib/execution/rpc", () => ({ bscPublicClient: vi.fn(), readBscWithRetry: (read: () => Promise<unknown>) => read() }));

import { signedRequest } from "./client";
import { bscPublicClient } from "@/lib/execution/rpc";
import { buildVenusRedeem } from "./defi-redeem";

const owner = "0x1111111111111111111111111111111111111111" as const;
const rate = 10000000018667150604327047777n;
const amount = 22021854209726850n;
const redeemTokens = amount * 10n ** 18n / rate;
const abi = parseAbi(["function redeem(uint256 redeemTokens) returns (uint256)"]);
const destination = { protocol: "Venus" as const, chainId: 56 as const, investmentId: "live-investment", assetAddress: NVDAB_ADDRESS, investable: true, observedAt: new Date().toISOString() };
const target = { chainId: 56 as const, underlying: "NVDA" as const, issuer: "bstock" as const, symbol: "NVDAB" as const, address: NVDAB_ADDRESS, decimals: 18, tokenToShareRatio: "1", open: true, observedAt: new Date().toISOString() };
function build(overrides: Record<string, unknown> = {}) {
  return { dataList: [{ callDataType: "REDEEM", from: owner, to: VENUS_VNVDAB_ADDRESS, value: "0x0",
    data: encodeFunctionData({ abi, functionName: "redeem", args: [redeemTokens] }), gasLimit: "3867026",
    gasPrice: null, maxPriorityFeePerGas: "67091668", maxFeePerGas: "67091668", ...overrides }],
    preview: { success: true, balanceChange: [{ tokenSymbol: "NVDAB", tokenAddress: NVDAB_ADDRESS, amount: "0.022021850041108519", valueUsd: "5.01" }], warnings: [] }, redeemDelayDays: [] };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(bscPublicClient).mockReturnValue({ readContract: vi.fn().mockResolvedValue(rate) } as unknown as ReturnType<typeof bscPublicClient>);
  vi.mocked(signedRequest).mockResolvedValue(build());
});

describe("Venus read-only redeem builder", () => {
  it("validates redeem calldata against the live exchange rate without requiring approval", async () => {
    const result = await buildVenusRedeem(owner, destination, target, amount.toString());
    expect(result).toMatchObject({ buildStatus: "READY", simulationStatus: "PASSED", approvalRequired: false,
      target: VENUS_VNVDAB_ADDRESS, functionName: "redeem", redeemVTokensRaw: redeemTokens.toString(),
      exchangeRateMantissa: rate.toString(), expectedUnderlyingOutRaw: (redeemTokens * rate / 10n ** 18n).toString(),
      valueWei: "0", calldataSelector: "0xdb006a75", redeemDelayDays: [] });
    expect(signedRequest).toHaveBeenCalledWith("POST", "/api/v1/defi/transaction/redeem", { body: expect.objectContaining({
      address: owner, investmentId: "live-investment", token: { tokenAddress: NVDAB_ADDRESS, amount: "0.02202185420972685" }, simulate: true,
    }) });
  });

  it("fails closed on an unexpected approval or target", async () => {
    vi.mocked(signedRequest).mockResolvedValueOnce({ ...build(), dataList: [{ ...build().dataList[0], callDataType: "APPROVE" }, ...build().dataList] });
    await expect(buildVenusRedeem(owner, destination, target, amount.toString())).rejects.toThrow("UNEXPECTED_REDEEM_ACTION_ORDER");
    vi.mocked(signedRequest).mockResolvedValueOnce(build({ to: NVDAB_ADDRESS }));
    await expect(buildVenusRedeem(owner, destination, target, amount.toString())).rejects.toThrow("INVALID_REDEEM_TARGET");
  });

  it("rejects a redeem-token amount that disagrees with the canonical exchange rate", async () => {
    vi.mocked(signedRequest).mockResolvedValueOnce(build({ data: encodeFunctionData({ abi, functionName: "redeem", args: [redeemTokens + 1n] }) }));
    await expect(buildVenusRedeem(owner, destination, target, amount.toString())).rejects.toThrow("REDEEM_EXCHANGE_RATE_MISMATCH");
  });
});
