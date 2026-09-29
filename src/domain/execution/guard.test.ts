import { describe, expect, it } from "vitest";
import { mainnetExecutionArmed, requireBroadcastRelease, requireMainnetExecutionArm } from "./guard";
import { POST } from "@/app/api/route/execute/route";

describe("Phase 3A execution guard", () => {
  it("defaults closed and accepts only exact true", () => {
    for (const value of [undefined, "false", "TRUE", "1", " true "]) {
      expect(mainnetExecutionArmed({ EQUITYRELAY_MAINNET_EXECUTION: value })).toBe(false);
      expect(() => requireMainnetExecutionArm({ EQUITYRELAY_MAINNET_EXECUTION: value })).toThrow("MAINNET_EXECUTION_NOT_ARMED");
    }
    expect(mainnetExecutionArmed({ EQUITYRELAY_MAINNET_EXECUTION: "true" })).toBe(true);
    expect(() => requireBroadcastRelease()).toThrow("PHASE3A_BROADCAST_DISABLED");
  });
  it("refuses the endpoint by default and rejects browser-supplied transaction fields", async () => {
    const before = process.env.EQUITYRELAY_MAINNET_EXECUTION;
    try {
      delete process.env.EQUITYRELAY_MAINNET_EXECUTION;
      const request = (body: object) => new Request("http://localhost/api/route/execute", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
      expect((await POST(request({}))).status).toBe(423);
      process.env.EQUITYRELAY_MAINNET_EXECUTION = "true";
      const safe = { executionIntentId: "11111111-1111-4111-8111-111111111111", confirmationToken: "x".repeat(40), boundary: "LEAVE_ONDO" };
      for (const injected of [{ to: "0x1234" }, { data: "0x1234" }, { calldata: "0x1234" }, { quoteId: "old" }, { value: "1" }, { tokenAddress: "0x1234" }]) {
        expect((await POST(request({ ...safe, ...injected }))).status).toBe(400);
      }
      const response = await POST(request(safe));
      expect(response.status).toBe(423);
      expect(await response.json()).toEqual({ code: "PHASE3A_BROADCAST_DISABLED" });
    } finally {
      if (before === undefined) delete process.env.EQUITYRELAY_MAINNET_EXECUTION;
      else process.env.EQUITYRELAY_MAINNET_EXECUTION = before;
    }
  });
});
