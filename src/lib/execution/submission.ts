import "server-only";
import { keccak256, parseTransaction, recoverTransactionAddress } from "viem";
import type { TransactionSerialized } from "viem";
import { sameAddress } from "@/domain/routing/identity";
import { requireBroadcastRelease, requireMainnetExecutionArm } from "@/domain/execution/guard";
import type { PreflightAction } from "@/types/preflight";
import type { ExecutionSession, ConfirmationBoundary } from "@/types/execution";
import { signedRequest } from "@/lib/binance/client";

export type OpaqueActionReference = { sessionId: string; boundary: ConfirmationBoundary; actionId: string };
export interface ExecutionPlanStore {
  resolve(reference: OpaqueActionReference): Promise<{ session: ExecutionSession; action: PreflightAction; actionId: string } | null>;
  revalidate(reference: OpaqueActionReference, session: ExecutionSession, action: PreflightAction): Promise<boolean>;
}

export async function validateWalletSignedAction(serializedTransaction: `0x${string}`, session: ExecutionSession, action: PreflightAction): Promise<`0x${string}`> {
  if (action.kind === "RFQ" || action.chainId !== 56 || !action.to || !action.rawCalldata || action.valueWei !== "0" ||
      !action.gasLimit || !/^[1-9]\d*$/.test(action.gasLimit)) throw new Error("UNSUPPORTED_EXECUTION_ACTION");
  const parsed = parseTransaction(serializedTransaction as TransactionSerialized);
  const signer = await recoverTransactionAddress({ serializedTransaction: serializedTransaction as TransactionSerialized });
  if (!(["legacy", "eip2930", "eip1559"] as const).some(type => type === parsed.type) || parsed.chainId !== 56 || !parsed.to || !sameAddress(parsed.to, action.to) ||
      parsed.data?.toLowerCase() !== action.rawCalldata.toLowerCase() || (parsed.value ?? 0n) !== 0n ||
      !sameAddress(signer, session.owner)) throw new Error("SIGNED_TRANSACTION_PLAN_MISMATCH");
  // Wallet-selected nonce and gas do not change action identity. Bound gas separately.
  if (!parsed.gas || parsed.gas <= 0n || parsed.gas > BigInt(action.gasLimit) * 3n) throw new Error("SIGNED_GAS_LIMIT_EXCEEDS_POLICY");
  if ("gasPrice" in parsed && parsed.gasPrice && action.gasPrice && parsed.gasPrice > BigInt(action.gasPrice) * 3n) throw new Error("SIGNED_GAS_PRICE_EXCEEDS_POLICY");
  if ("maxFeePerGas" in parsed && parsed.maxFeePerGas && action.maxFeePerGas && parsed.maxFeePerGas > BigInt(action.maxFeePerGas) * 3n) throw new Error("SIGNED_GAS_PRICE_EXCEEDS_POLICY");
  return keccak256(serializedTransaction);
}

export async function submitWalletSignedAction(reference: OpaqueActionReference, signedTransaction: `0x${string}`, store: ExecutionPlanStore): Promise<never> {
  requireMainnetExecutionArm();
  const resolved = await store.resolve(reference);
  if (!resolved || resolved.session.id !== reference.sessionId || resolved.actionId !== reference.actionId ||
      !resolved.session.confirmations.includes(reference.boundary)) throw new Error("CONFIRMED_SERVER_PLAN_REQUIRED");
  await validateWalletSignedAction(signedTransaction, resolved.session, resolved.action);
  if (!await store.revalidate(reference, resolved.session, resolved.action)) throw new Error("SERVER_PLAN_REVALIDATION_FAILED");
  // Deliberate Phase 3A code-level lock. A later reviewed release must remove it
  // and add durable, atomic replay protection before the following call can run.
  const owner = resolved.session.owner;
  requireBroadcastRelease();
  await signedRequest("POST", "/api/v1/dex/pre-transaction/broadcast-transaction", {
    body: { binanceChainId: "56", signedTransaction, address: owner },
  });
  throw new Error("BROADCAST_RESULT_UNIMPLEMENTED");
}
