import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Eip1193Provider } from "./providers";

const mocks = vi.hoisted(() => ({ handoff: vi.fn() }));
vi.mock("./transaction-handoff", () => ({ prepareLockedWalletHandoff: mocks.handoff }));
import { runSetupApproval } from "./setup-approval-flow";

const provider = { request: vi.fn() } as Eip1193Provider;
const txHash = `0x${"a".repeat(64)}` as `0x${string}`;

describe("test setup approval browser lifecycle", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.handoff.mockResolvedValue({ txHash, stepId: "step-1" }); });

  it("uses the approval stage, reports only the tx hash, and polls canonical confirmation", async () => {
    const responses = [
      new Response(JSON.stringify({ state: "WAITING_FOR_CANONICAL_CONFIRMATION" })),
      new Response(JSON.stringify({ state: "CONFIRMED" })),
    ];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => { void input; void init; return responses.shift()!; });
    const statuses: string[] = [];
    await expect(runSetupApproval({ provider, routeId: "route-1", fetcher: fetcher as typeof fetch,
      wait: async () => {}, onStatus: status => statuses.push(status) })).resolves.toEqual({ status: "CONFIRMED",txHash,stepId:"step-1" });
    expect(mocks.handoff).toHaveBeenCalledWith(expect.objectContaining({ provider,routeId:"route-1",stage:"TEST_SETUP_APPROVAL" }));
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ operation: "REPORT", txHash });
    expect(Object.keys(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)))).toEqual(["operation","txHash"]);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ operation: "RECONCILE" });
    expect(statuses).toEqual(["REQUESTING_WALLET","WAITING_FOR_CANONICAL_CONFIRMATION","CONFIRMED"]);
    expect(mocks.handoff).toHaveBeenCalledTimes(1);
  });

  it("stops on canonical failure and never opens a second wallet prompt", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input; void init; return new Response(JSON.stringify({ state: "FAILED" }));
    });
    await expect(runSetupApproval({ provider,routeId:"route-1",fetcher:fetcher as typeof fetch }))
      .resolves.toEqual({ status:"FAILED",txHash,stepId:"step-1" });
    expect(mocks.handoff).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not report or retry when the wallet handoff is rejected or quote refresh is required", async () => {
    const fetcher = vi.fn();
    for (const message of ["User rejected the request", "QUOTE_REFRESH_REQUIRED"]) {
      mocks.handoff.mockRejectedValueOnce(new Error(message));
      await expect(runSetupApproval({ provider,routeId:"route-1",fetcher:fetcher as typeof fetch })).rejects.toThrow(message);
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.handoff).toHaveBeenCalledTimes(2);
  });
});
