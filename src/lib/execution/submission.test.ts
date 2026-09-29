import { describe, expect, it, vi } from "vitest";
import type { ExecutionSession } from "@/types/execution";
import type { PreflightAction } from "@/types/preflight";

vi.mock("server-only", () => ({}));
vi.mock("viem", () => ({ parseTransaction: vi.fn(), recoverTransactionAddress: vi.fn(), keccak256: vi.fn(() => `0x${"a".repeat(64)}`) }));
vi.mock("@/lib/binance/client", () => ({ signedRequest: vi.fn() }));
import { parseTransaction, recoverTransactionAddress } from "viem";
import { signedRequest } from "@/lib/binance/client";
import { submitWalletSignedAction } from "./submission";

const owner = "0x1111111111111111111111111111111111111111";
const target = "0x2222222222222222222222222222222222222222";
const reference = { sessionId: "opaque", actionId: "only-server-generated", boundary: "LEAVE_ONDO" as const };
const session = { id: "opaque", owner, confirmations: ["LEAVE_ONDO"] } as unknown as ExecutionSession;
const action = { kind: "SWAP", chainId: 56, from: owner, to: target, rawCalldata: "0x12345678", valueWei: "0", gasLimit: "450000", gasPrice: "1000000000" } as unknown as PreflightAction;
const store = { resolve: vi.fn(async () => ({ session, action, actionId: reference.actionId })), revalidate: vi.fn(async () => true) };

describe("wallet-signed submission boundary", () => {
  it("blocks while unarmed without touching the plan store or Binance", async () => {
    const before = process.env.EQUITYRELAY_MAINNET_EXECUTION;
    try {
      delete process.env.EQUITYRELAY_MAINNET_EXECUTION;
      store.resolve.mockClear();
      await expect(submitWalletSignedAction(reference, "0x1234", store)).rejects.toThrow("MAINNET_EXECUTION_NOT_ARMED");
      expect(store.resolve).not.toHaveBeenCalled();
      expect(store.revalidate).not.toHaveBeenCalled();
      expect(signedRequest).not.toHaveBeenCalled();
    } finally { if (before === undefined) delete process.env.EQUITYRELAY_MAINNET_EXECUTION; else process.env.EQUITYRELAY_MAINNET_EXECUTION = before; }
  });
  it("even when armed, checks the signed plan then hits the Phase 3A hard stop", async () => {
    const before = process.env.EQUITYRELAY_MAINNET_EXECUTION;
    try {
      process.env.EQUITYRELAY_MAINNET_EXECUTION = "true";
      vi.mocked(parseTransaction).mockReturnValue({ type: "eip1559", chainId: 56, to: target, data: "0x12345678", value: 0n, gas: 450000n } as ReturnType<typeof parseTransaction>);
      vi.mocked(recoverTransactionAddress).mockResolvedValue(owner);
      await expect(submitWalletSignedAction(reference, "0x1234", store)).rejects.toThrow("PHASE3A_BROADCAST_DISABLED");
      expect(store.revalidate).toHaveBeenCalled();
      expect(signedRequest).not.toHaveBeenCalled();
      store.revalidate.mockResolvedValueOnce(false);
      await expect(submitWalletSignedAction(reference, "0x1234", store)).rejects.toThrow("SERVER_PLAN_REVALIDATION_FAILED");
      vi.mocked(parseTransaction).mockReturnValue({ type: "eip1559", chainId: 56, to: owner, data: "0x12345678", value: 0n, gas: 450000n } as ReturnType<typeof parseTransaction>);
      await expect(submitWalletSignedAction(reference, "0x1234", store)).rejects.toThrow("SIGNED_TRANSACTION_PLAN_MISMATCH");
      expect(signedRequest).not.toHaveBeenCalled();
    } finally { if (before === undefined) delete process.env.EQUITYRELAY_MAINNET_EXECUTION; else process.env.EQUITYRELAY_MAINNET_EXECUTION = before; }
  });
});
