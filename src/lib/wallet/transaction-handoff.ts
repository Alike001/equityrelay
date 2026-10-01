import type { WalletTransactionRequest } from "@/lib/execution/handoff";
import type { Eip1193Provider } from "@/lib/wallet/providers";
import type { ExecutionActionV1 } from "@/domain/execution/action";

export type WalletHandoffState = "READY_FOR_WALLET_REVIEW" | "QUOTE_REFRESH_REQUIRED" |
  "WAITING_FOR_CANONICAL_CONFIRMATION" | "CONFIRMED" | "FAILED";

// Separate hard stop for the connected-wallet RPC. It remains in addition to
// the server environment arm and PHASE3A_BROADCAST_DISABLED relay lock.
export function requireConnectedWalletSendRelease(): never {
  throw new Error("PHASE3E_WALLET_SEND_DISABLED");
}

export async function handoffSelectedWalletTransaction(provider: Eip1193Provider, transaction: WalletTransactionRequest): Promise<never> {
  const [accounts, chainId] = await Promise.all([
    provider.request({ method: "eth_accounts" }) as Promise<string[]>,
    provider.request({ method: "eth_chainId" }) as Promise<string>,
  ]);
  if (chainId.toLowerCase() !== "0x38") throw new Error("BSC_CHAIN_REQUIRED");
  if (!accounts.some(account => account.toLowerCase() === transaction.from.toLowerCase())) throw new Error("SESSION_WALLET_MISMATCH");
  requireConnectedWalletSendRelease();
  // This statement is deliberately unreachable until a separate reviewed
  // release removes the code lock. The exact selected provider is retained.
  await provider.request({ method: "eth_sendTransaction", params: [{ from: transaction.from, to: transaction.to,
    data: transaction.data, value: transaction.value, chainId: transaction.chainId }] });
  throw new Error("WALLET_TRANSACTION_RESULT_UNIMPLEMENTED");
}

// Complete browser-side handoff boundary. This accepts route identity only;
// transaction semantics always come back from authenticated server state.
// The final call still terminates at PHASE3E_WALLET_SEND_DISABLED.
export async function prepareLockedWalletHandoff(input: { provider: Eip1193Provider; routeId: string;
  stage: ExecutionActionV1["stage"]; idempotencyKey: string; fetcher?: typeof fetch }): Promise<never> {
  const fetcher = input.fetcher ?? fetch;
  const confirmationResponse = await fetcher(`/api/execution/routes/${input.routeId}/confirmations`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "ISSUE", stage: input.stage, idempotencyKey: input.idempotencyKey }),
  });
  if (!confirmationResponse.ok) throw new Error((await confirmationResponse.json() as { code?: string }).code ?? "CONFIRMATION_UNAVAILABLE");
  const confirmation = await confirmationResponse.json() as { confirmationToken: string; actionHash: string;
    routeVersion: number; stepId: string; stage: ExecutionActionV1["stage"] };
  const actionResponse = await fetcher(`/api/execution/routes/${input.routeId}/actions/${confirmation.stepId}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage: confirmation.stage, confirmationToken: confirmation.confirmationToken,
      actionHash: confirmation.actionHash, routeVersion: confirmation.routeVersion }),
  });
  if (!actionResponse.ok) throw new Error((await actionResponse.json() as { code?: string }).code ?? "ACTION_DELIVERY_UNAVAILABLE");
  const delivered = await actionResponse.json() as { transaction: WalletTransactionRequest };
  return handoffSelectedWalletTransaction(input.provider, delivered.transaction);
}
