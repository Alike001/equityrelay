import "server-only";
import { z } from "zod";
import { BinanceApiError, signedRequest } from "./client";
import { decodeApprovalCalldata, isWalletStateFailure, unavailableSimulation, validateEvmAction } from "@/domain/preflight/validate";
import { NVDAB_ADDRESS, sameAddress } from "@/domain/routing/identity";
import { decimalText, rawToDecimal } from "@/domain/exposure/decimal";
import type { Address, DestinationSnapshot, RepresentationSnapshot } from "@/types/route";
import type { PreflightAction, PreflightStage, SimulationResult } from "@/types/preflight";

const RawItem = z.object({
  callDataType: z.string(), from: z.string(), to: z.string(), value: z.string(), data: z.string(),
  gasLimit: z.string().nullable().optional(), gasPrice: z.string().nullable().optional(),
  maxPriorityFeePerGas: z.string().nullable().optional(), maxFeePerGas: z.string().nullable().optional(),
});
const Preview = z.object({
  success: z.boolean().optional(), errorMessage: z.string().optional().nullable(),
  balanceChange: z.array(z.object({ tokenSymbol: z.string().optional(), amount: z.string().optional(), valueUsd: z.string().nullable().optional() })).optional(),
  feeAndContract: z.object({ estimatedNetworkFee: z.object({ amount: z.string().nullable().optional(), tokenSymbol: z.string().optional() }).optional() }).optional(),
  healthFactor: z.object({ before: z.string().nullable().optional(), after: z.string().nullable().optional() }).optional(),
  warnings: z.array(z.object({ code: z.string().optional(), level: z.string().optional(), message: z.string().optional() })).optional(),
});
const Build = z.object({ dataList: z.array(RawItem), preview: Preview.optional().nullable() });

export async function buildVenusDeposit(owner: Address, destination: DestinationSnapshot, target: RepresentationSnapshot, amountRaw: string): Promise<PreflightStage> {
  if (!destination.investable || !sameAddress(destination.assetAddress, NVDAB_ADDRESS) || !sameAddress(target.address, NVDAB_ADDRESS)) throw new Error("VENUS_DESTINATION_UNAVAILABLE");
  const amountHuman = decimalText(rawToDecimal(amountRaw, target.decimals));
  const requestBody = { address: owner, investmentId: destination.investmentId, token: { tokenAddress: target.address, amount: amountHuman } };
  let data: unknown;
  let walletSimulationReason: string | null = null;
  try {
    data = await signedRequest("POST", "/api/v1/defi/transaction/deposit", { body: { ...requestBody, simulate: true } });
  } catch (error) {
    if (!(error instanceof BinanceApiError) || !isWalletStateFailure(error.message)) throw error;
    walletSimulationReason = `${error.businessCode}: ${error.message}`;
    // A genuine balance-dependent simulation error does not prevent a separate unsigned
    // build-only request. Never represent this fallback as a successful simulation.
    try { data = await signedRequest("POST", "/api/v1/defi/transaction/deposit", { body: { ...requestBody, simulate: false } }); }
    catch (buildError) {
      const buildReason = buildError instanceof BinanceApiError ? `${buildError.businessCode}: ${buildError.message}` : "Unsigned deposit build unavailable.";
      return { label: "Prepare Venus", indicative: true, buildStatus: "UNAVAILABLE", actions: [], simulationStatus: "BLOCKED_BY_WALLET_STATE", reason: `${walletSimulationReason}; build-only fallback: ${buildReason}`, previewDetails: null };
    }
  }
  const build = Build.parse(data);
  if (!build.dataList.length || build.dataList.at(-1)?.callDataType !== "DEPOSIT" || build.dataList.filter(x => x.callDataType === "DEPOSIT").length !== 1 ||
      build.dataList.slice(0, -1).some(x => x.callDataType !== "APPROVE")) throw new Error("INVALID_DEPOSIT_ACTION_ORDER");
  const actions: PreflightAction[] = build.dataList.map(item => {
    if (item.callDataType === "APPROVE") {
      if (!sameAddress(item.to, target.address)) throw new Error("INVALID_DEPOSIT_APPROVAL_TARGET");
      const decoded = decodeApprovalCalldata(item.data, amountRaw, true);
      const action = validateEvmAction({ kind: "APPROVAL", chainId: 56, from: item.from, to: item.to, data: item.data, value: item.value, valueFormat: "hex", gasLimit: item.gasLimit, gasPrice: item.gasPrice, maxPriorityFeePerGas: item.maxPriorityFeePerGas, maxFeePerGas: item.maxFeePerGas, tokenIn: target.address, tokenOut: null, amountInRaw: decoded.amountRaw, expectedFrom: owner, expectedTo: target.address });
      return { ...action, approvalSpender: decoded.spender, approvalAmountRaw: decoded.amountRaw, approvalExceedsInput: decoded.exceedsInput };
    }
    return validateEvmAction({ kind: "DEPOSIT", chainId: 56, from: item.from, to: item.to, data: item.data, value: item.value, valueFormat: "hex", gasLimit: item.gasLimit, gasPrice: item.gasPrice, maxPriorityFeePerGas: item.maxPriorityFeePerGas, maxFeePerGas: item.maxFeePerGas, tokenIn: target.address, tokenOut: null, amountInRaw: amountRaw, expectedFrom: owner });
  });
  const preview = build.preview;
  const failReason = walletSimulationReason ?? preview?.errorMessage?.trim() ?? null;
  const status: SimulationResult["status"] = walletSimulationReason ? "BLOCKED_BY_WALLET_STATE" : preview?.success === true && !failReason ? "PASSED" : preview?.success === false && failReason && isWalletStateFailure(failReason) ? "BLOCKED_BY_WALLET_STATE" : preview?.success === false || failReason ? "FAILED" : "UNAVAILABLE";
  const warnings = (preview?.warnings ?? []).map(x => [x.code, x.level, x.message].filter(Boolean).join(" · "));
  const simulation: SimulationResult = { ...unavailableSimulation(failReason ?? "Binance did not return a deposit simulation verdict."), status, warnings };
  return {
    label: "Prepare Venus", indicative: true, buildStatus: "READY", actions: actions.map(x => ({ ...x, simulation })),
    simulationStatus: status, reason: failReason,
    previewDetails: preview ? {
      balanceChanges: (preview.balanceChange ?? []).map(x => ({ tokenSymbol: x.tokenSymbol ?? "", amount: x.amount ?? "", valueUsd: x.valueUsd ?? null })),
      estimatedNetworkFee: preview.feeAndContract?.estimatedNetworkFee?.amount && preview.feeAndContract.estimatedNetworkFee.tokenSymbol
        ? `${preview.feeAndContract.estimatedNetworkFee.amount} ${preview.feeAndContract.estimatedNetworkFee.tokenSymbol}` : null,
      healthFactorBefore: preview.healthFactor?.before ?? null, healthFactorAfter: preview.healthFactor?.after ?? null,
    } : null,
  };
}
