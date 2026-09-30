import { describe, expect, it } from "vitest";
import { connectedWalletMatchesSession } from "./wallet-binding";

describe("browser wallet session binding", () => {
  const wallet = "0x1111111111111111111111111111111111111111";
  it("requires the signed-in account on BSC after refresh or wallet changes", () => {
    expect(connectedWalletMatchesSession(wallet, [wallet], "0x38")).toBe(true);
    expect(connectedWalletMatchesSession(wallet, ["0x2222222222222222222222222222222222222222"], "0x38")).toBe(false);
    expect(connectedWalletMatchesSession(wallet, [wallet], "0x1")).toBe(false);
    expect(connectedWalletMatchesSession(wallet, [], "0x38")).toBe(false);
    expect(connectedWalletMatchesSession(null, [wallet], "0x38")).toBe(false);
  });
});
