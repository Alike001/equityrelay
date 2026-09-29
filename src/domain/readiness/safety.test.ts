import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ReadinessIntentSchema } from "@/lib/intent";

const root = path.resolve(import.meta.dirname, "../..");
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(path.join(dir, item.name)) : item.name.endsWith(".ts") || item.name.endsWith(".tsx") ? [path.join(dir, item.name)] : []);
}
describe("read-only boundary", () => {
  it("rejects browser-controlled token addresses, investment ids and calldata", () => {
    const address = "0x1111111111111111111111111111111111111111";
    expect(ReadinessIntentSchema.safeParse({ address }).success).toBe(true);
    for (const field of ["tokenAddress", "investmentId", "calldata", "amount", "maxExposureLossBps"]) {
      expect(ReadinessIntentSchema.safeParse({ address, [field]: "injected" }).success).toBe(false);
    }
  });
  it("keeps test setup distinct and avoids funding directives in the readiness surface", () => {
    const source = readFileSync(path.join(root, "lib/binance/readiness.ts"), "utf8");
    const ui = readFileSync(path.join(root, "components/readiness/readiness-review.tsx"), "utf8");
    expect(source).toContain('kind: "TEST_SETUP"');
    expect(ui).toContain("Separate test setup");
    expect(ui).not.toMatch(/fund this now|buy now|execute now/i);
  });
  it("introduces no execute endpoint, signer or private key handling", () => {
    const routes = files(path.join(root, "app/api")).map(file => path.relative(root, file));
    expect(routes).toEqual(expect.arrayContaining(["app/api/proof/readiness/route.ts"]));
    expect(routes.some(file => /execute|broadcast|sign|submit/i.test(file))).toBe(false);
    const newSources = ["lib/binance/readiness.ts", "lib/binance/gas.ts", "lib/binance/wallet.ts", "app/api/proof/readiness/route.ts"];
    for (const file of newSources) expect(readFileSync(path.join(root, file), "utf8")).not.toMatch(/\b(?:sendTransaction|signTransaction|broadcastTransaction|privateKey|seedPhrase)\b/);
  });
});
