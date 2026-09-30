import { describe, expect, it, vi } from "vitest";
import { parseRequestedBalances } from "./balance";
import { calculateGasEstimate, classifyCandidateError, firstViableCandidate, fundingRequirement, gasCostBNB, PROOF_CANDIDATES } from "./analysis";
import type { CandidateResult, ProofAsset } from "@/types/readiness";

const owner = "0x1111111111111111111111111111111111111111";
const requested: Record<ProofAsset, `0x${string}` | ""> = {
  BNB: "", NVDAon: "0x2222222222222222222222222222222222222222", USDT: "0x3333333333333333333333333333333333333333", NVDAB: "0x4444444444444444444444444444444444444444",
};
describe("read-only proof wallet", () => {
  it("parses native BNB and only requested assets, and treats omitted tokens as zero", () => {
    const result = parseRequestedBalances([{ tokenAssets: [
      { binanceChainId: "56", tokenContractAddress: "", address: owner, balance: "0.0001", rawBalance: "100000000000000" },
      { binanceChainId: "56", tokenContractAddress: requested.USDT, address: owner, balance: "12.5", rawBalance: "12500000000000000000" },
      { binanceChainId: "56", tokenContractAddress: "0x5555555555555555555555555555555555555555", address: owner, balance: "999", rawBalance: "999" },
    ] }], owner, requested);
    expect(result.walletShort).toBe("0x1111…1111");
    expect(Object.keys(result.assets)).toEqual(["BNB", "NVDAon", "USDT", "NVDAB"]);
    expect(result.assets.BNB.balance).toBe("0.0001");
    expect(result.assets.NVDAon).toMatchObject({ balance: "0", reported: false });
    expect(JSON.stringify(result)).not.toContain("999");
    expect(fundingRequirement(result, "BNB", "0.001", "reserve").gap).toBe("0.0009");
  });
  it("rejects a balance attributed to a different wallet", () => {
    expect(() => parseRequestedBalances([{ tokenAssets: [{ binanceChainId: "56", tokenContractAddress: "", address: "0x6666666666666666666666666666666666666666", balance: "1" }] }], owner, requested)).toThrow();
  });
});
describe("smallest technical route", () => {
  const result = (amount: string, viable: boolean): CandidateResult => ({ amount, viable, status: viable ? "WALLET_STATE_BLOCKED" : "POLICY_BLOCKED", retentionPercent: viable ? "99.93" : "99", venusBuild: viable ? "READY" : null, reason: null, quotedUsdtOutput: null, quotedNvdabOutput: null });
  it("probes ascending and stops after the first complete viable route", async () => {
    expect(PROOF_CANDIDATES).toEqual(["0.021", "0.022", "0.023", "0.024", "0.025", "0.0275", "0.03"]);
    const probe = vi.fn(async amount => result(amount, amount === "0.023"));
    const scan = await firstViableCandidate(probe);
    expect(probe.mock.calls.map(x => x[0])).toEqual(["0.021", "0.022", "0.023"]);
    expect(scan.smallestViable?.amount).toBe("0.023");
  });
  it("only calls a quote below minimum when the error says so", () => {
    expect(classifyCandidateError("40301", "Amount is below minimum trade size")).toBe("BELOW_MINIMUM");
    expect(classifyCandidateError("40401", "No route")).toBe("API_UNAVAILABLE");
    expect(classifyCandidateError("40368", "Ondo assets only pair with stablecoins")).toBe("API_UNAVAILABLE");
  });
});
describe("gas math", () => {
  it("uses integer wei and a separate conservative buffer", () => {
    expect(gasCostBNB("100000", "1000000000")).toBe("0.0001");
    const gas = calculateGasEstimate("200000", "100000", "1000000000", "LEGACY_MEDIUM", []);
    expect(gas.estimatedProofCostBNB).toBe("0.0002");
    expect(gas.estimatedSetupCostBNB).toBe("0.0001");
    expect(gas.recommendedTotalGasReserveBNB).toBe("0.0006");
    expect(gas.complete).toBe(true);
  });
  it("does not invent a total reserve when setup gas is missing", () => {
    expect(calculateGasEstimate("200000", null, "1000000000", "LEGACY_MEDIUM", ["Setup unavailable"]).recommendedTotalGasReserveBNB).toBeNull();
  });
});
