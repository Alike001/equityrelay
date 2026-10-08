import type { Eip1193Provider } from "./providers";
import { prepareLockedWalletHandoff } from "./transaction-handoff";

export type SetupApprovalStatus = "REQUESTING_WALLET" | "WAITING_FOR_CANONICAL_CONFIRMATION" | "CONFIRMED" | "FAILED";
export type SetupApprovalResult = { status: "CONFIRMED" | "FAILED"; txHash: `0x${string}`; stepId: string };

function code(response: Response, fallback: string): Promise<never> {
  return response.json().then(value => { throw new Error((value as { code?: string }).code ?? fallback); });
}

export async function runSetupApproval(input: {
  provider: Eip1193Provider;
  routeId: string;
  fetcher?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  onStatus?: (status: SetupApprovalStatus) => void;
  active?: () => boolean;
}): Promise<SetupApprovalResult> {
  const fetcher = input.fetcher ?? fetch;
  const wait = input.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  input.onStatus?.("REQUESTING_WALLET");
  const handoff = await prepareLockedWalletHandoff({ provider: input.provider, routeId: input.routeId,
    stage: "TEST_SETUP_APPROVAL", idempotencyKey: crypto.randomUUID(), fetcher });
  input.onStatus?.("WAITING_FOR_CANONICAL_CONFIRMATION");
  const endpoint = `/api/execution/routes/${input.routeId}/transactions/${handoff.stepId}`;
  let response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "REPORT", txHash: handoff.txHash }) });
  if (!response.ok) return code(response, "TRANSACTION_REPORT_UNAVAILABLE");
  let result = await response.json() as { state?: string };
  while (result.state !== "CONFIRMED" && result.state !== "FAILED") {
    if (input.active && !input.active()) throw new Error("CANONICAL_POLL_CANCELLED");
    await wait(4_000);
    response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "RECONCILE" }) });
    if (!response.ok) return code(response, "CANONICAL_RECONCILIATION_UNAVAILABLE");
    result = await response.json() as { state?: string };
  }
  const status = result.state as "CONFIRMED" | "FAILED";
  input.onStatus?.(status);
  return { status, txHash: handoff.txHash, stepId: handoff.stepId };
}
