import "server-only";
import { decodeFunctionData, parseAbi } from "viem";
import { z } from "zod";
import { decimalText, rawToDecimal } from "@/domain/exposure/decimal";
import { isWalletStateFailure, parseGas, parseUnsignedValue } from "@/domain/preflight/validate";
import { NVDAB_ADDRESS, sameAddress, VENUS_VNVDAB_ADDRESS } from "@/domain/routing/identity";
import type { Address, DestinationSnapshot, RepresentationSnapshot } from "@/types/route";
import { bscPublicClient, readBscWithRetry } from "@/lib/execution/rpc";
import { BinanceApiError, signedRequest } from "./client";

const redeemAbi = parseAbi([
  "function redeem(uint256 redeemTokens) returns (uint256)",
  "function redeemUnderlying(uint256 redeemAmount) returns (uint256)",
  "function exchangeRateStored() view returns (uint256)",
]);
const Item = z.object({
  callDataType: z.string(), from: z.string(), to: z.string(), value: z.string(), data: z.string(),
  gasLimit: z.string().nullable().optional(), gasPrice: z.string().nullable().optional(),
  maxPriorityFeePerGas: z.string().nullable().optional(), maxFeePerGas: z.string().nullable().optional(),
});
const Preview = z.object({
  success: z.boolean().optional(), errorMessage: z.string().nullable().optional(),
  balanceChange: z.array(z.object({ tokenSymbol: z.string().optional(), tokenAddress: z.string().optional(), amount: z.string().optional(), valueUsd: z.string().nullable().optional() })).optional(),
  feeAndContract: z.object({ estimatedNetworkFee: z.object({ amount: z.string().nullable().optional(), tokenSymbol: z.string().optional(), valueUsd: z.string().nullable().optional() }).optional() }).optional(),
  warnings: z.array(z.object({ code: z.string().optional(), level: z.string().optional(), message: z.string().optional() })).optional(),
});
const Build = z.object({ dataList: z.array(Item), preview: Preview.optional().nullable(), redeemDelayDays: z.array(z.string()).optional().nullable() });

export type VenusRedeemBuild = {
  buildStatus: "READY" | "UNAVAILABLE";
  simulationStatus: "PASSED" | "BLOCKED_BY_WALLET_STATE" | "FAILED" | "UNAVAILABLE";
  reason: string | null;
  approvalRequired: boolean;
  target: Address | null;
  functionName: "redeem" | "redeemUnderlying" | null;
  redeemVTokensRaw: string | null;
  exchangeRateMantissa: string | null;
  expectedUnderlyingOutRaw: string;
  amountUnderlyingRaw: string;
  amountUnderlyingHuman: string;
  valueWei: string | null;
  calldataSelector: string | null;
  rawCalldata: `0x${string}` | null;
  gasLimit: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  redeemDelayDays: string[] | null;
  preview: { balanceChanges: Array<{ tokenSymbol: string; tokenAddress: string; amount: string; valueUsd: string | null }>; estimatedNetworkFee: string | null; warnings: string[] } | null;
};

function unavailable(amountRaw: string, amountHuman: string, reason: string, status: VenusRedeemBuild["simulationStatus"]): VenusRedeemBuild {
  return { buildStatus: "UNAVAILABLE", simulationStatus: status, reason, approvalRequired: false, target: null,
    functionName: null, redeemVTokensRaw: null, exchangeRateMantissa: null, expectedUnderlyingOutRaw: amountRaw,
    amountUnderlyingRaw: amountRaw, amountUnderlyingHuman: amountHuman, valueWei: null,
    calldataSelector: null, rawCalldata: null, gasLimit: null, maxFeePerGas: null, maxPriorityFeePerGas: null, redeemDelayDays: null, preview: null };
}

export async function buildVenusRedeem(owner: Address, destination: DestinationSnapshot, target: RepresentationSnapshot, amountRaw: string,
  exactVTokensRaw?: string): Promise<VenusRedeemBuild> {
  if (exactVTokensRaw) {
    if (!/^[1-9]\d*$/.test(exactVTokensRaw)) throw new Error("INVALID_REDEEM_AMOUNT");
    const rate = await readBscWithRetry(() => bscPublicClient().readContract({ address: VENUS_VNVDAB_ADDRESS, abi: redeemAbi, functionName: "exchangeRateStored" }));
    amountRaw = ((BigInt(exactVTokensRaw) * rate + 10n ** 18n - 1n) / 10n ** 18n).toString();
  }
  const amountHuman = decimalText(rawToDecimal(amountRaw, target.decimals));
  if (!destination.investable || !sameAddress(destination.assetAddress, NVDAB_ADDRESS) || !sameAddress(target.address, NVDAB_ADDRESS))
    return unavailable(amountRaw, amountHuman, "DESTINATION_UNAVAILABLE", "UNAVAILABLE");
  const body = { address: owner, investmentId: destination.investmentId, token: { tokenAddress: target.address, amount: amountHuman } };
  let raw: unknown;
  let simulationReason: string | null = null;
  try {
    raw = await signedRequest("POST", "/api/v1/defi/transaction/redeem", { body: { ...body, simulate: true } });
  } catch (error) {
    if (!(error instanceof BinanceApiError) || !(error.businessCode === "40485" || isWalletStateFailure(error.message))) throw error;
    simulationReason = `${error.businessCode}: ${error.message}`;
    try { raw = await signedRequest("POST", "/api/v1/defi/transaction/redeem", { body: { ...body, simulate: false } }); }
    catch (buildError) {
      const reason = buildError instanceof BinanceApiError ? `${buildError.businessCode}: ${buildError.message}` : "Redeem build unavailable.";
      return unavailable(amountRaw, amountHuman, `${simulationReason}; build-only fallback: ${reason}`, "BLOCKED_BY_WALLET_STATE");
    }
  }
  const build = Build.parse(raw);
  const approvals = build.dataList.filter(item => item.callDataType === "APPROVE");
  const redeems = build.dataList.filter(item => item.callDataType === "REDEEM");
  if (approvals.length || redeems.length !== 1 || build.dataList.length !== 1) throw new Error("UNEXPECTED_REDEEM_ACTION_ORDER");
  const item = redeems[0];
  if (!sameAddress(item.from, owner) || !sameAddress(item.to, VENUS_VNVDAB_ADDRESS)) throw new Error("INVALID_REDEEM_TARGET");
  if (parseUnsignedValue(item.value, "hex") !== "0") throw new Error("UNEXPECTED_NATIVE_VALUE");
  let decoded: ReturnType<typeof decodeFunctionData>;
  try { decoded = decodeFunctionData({ abi: redeemAbi, data: item.data as `0x${string}` }); }
  catch { throw new Error("INVALID_REDEEM_CALLDATA"); }
  let redeemVTokensRaw: string | null = null;
  let exchangeRateMantissa: string | null = null;
  let expectedUnderlyingOutRaw = amountRaw;
  const decodedAmount = BigInt(decoded.args[0] as bigint);
  if (decoded.functionName === "redeemUnderlying") {
    if (decodedAmount.toString() !== amountRaw) throw new Error("REDEEM_AMOUNT_MISMATCH");
  } else if (decoded.functionName === "redeem") {
    const rate = await readBscWithRetry(() => bscPublicClient().readContract({ address: VENUS_VNVDAB_ADDRESS, abi: redeemAbi, functionName: "exchangeRateStored" }));
    const expectedVTokens = BigInt(amountRaw) * 10n ** 18n / rate;
    if (expectedVTokens <= 0n || decodedAmount !== expectedVTokens || exactVTokensRaw && decodedAmount.toString() !== exactVTokensRaw)
      throw new Error("REDEEM_EXCHANGE_RATE_MISMATCH");
    redeemVTokensRaw = expectedVTokens.toString();
    exchangeRateMantissa = rate.toString();
    expectedUnderlyingOutRaw = (expectedVTokens * rate / 10n ** 18n).toString();
  } else throw new Error("INVALID_REDEEM_CALLDATA");
  const preview = build.preview;
  const failReason = simulationReason ?? preview?.errorMessage?.trim() ?? null;
  const simulationStatus: VenusRedeemBuild["simulationStatus"] = simulationReason ? "BLOCKED_BY_WALLET_STATE" :
    preview?.success === true && !failReason ? "PASSED" :
    failReason && isWalletStateFailure(failReason) ? "BLOCKED_BY_WALLET_STATE" :
    preview?.success === false || failReason ? "FAILED" : "UNAVAILABLE";
  return {
    buildStatus: "READY", simulationStatus, reason: failReason, approvalRequired: false,
    target: item.to as Address, functionName: decoded.functionName, redeemVTokensRaw, exchangeRateMantissa, expectedUnderlyingOutRaw,
    amountUnderlyingRaw: amountRaw, amountUnderlyingHuman: amountHuman,
    valueWei: "0", calldataSelector: item.data.slice(0, 10), rawCalldata: item.data as `0x${string}`, gasLimit: parseGas(item.gasLimit),
    maxFeePerGas: parseGas(item.maxFeePerGas, true), maxPriorityFeePerGas: parseGas(item.maxPriorityFeePerGas, true),
    redeemDelayDays: build.redeemDelayDays ?? null,
    preview: preview ? {
      balanceChanges: (preview.balanceChange ?? []).map(change => ({ tokenSymbol: change.tokenSymbol ?? "", tokenAddress: change.tokenAddress ?? "", amount: change.amount ?? "", valueUsd: change.valueUsd ?? null })),
      estimatedNetworkFee: preview.feeAndContract?.estimatedNetworkFee?.amount && preview.feeAndContract.estimatedNetworkFee.tokenSymbol
        ? `${preview.feeAndContract.estimatedNetworkFee.amount} ${preview.feeAndContract.estimatedNetworkFee.tokenSymbol}` : null,
      warnings: (preview.warnings ?? []).map(warning => [warning.code, warning.level, warning.message].filter(Boolean).join(" · ")),
    } : null,
  };
}
