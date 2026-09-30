import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
describe("Phase 3B remains read-only", () => {
  it("does not add provider broadcast or backend signer paths and retains the code lock", () => {
    const files = ["src/components/route/wallet-auth.tsx", "src/components/route/preflight-review.tsx",
      "src/lib/execution/canonical.ts", "src/lib/execution/reconcile.ts", "src/lib/execution/lost-hash.ts",
      "src/lib/execution/post-settlement.ts", "src/app/api/execution/routes/route.ts"];
    for (const file of files) {
      const code = readFileSync(join(root, file), "utf8");
      expect(code).not.toMatch(/eth_sendTransaction|sendRawTransaction|sendTransaction\(|signTransaction\(|privateKeyToAccount|seedPhrase/);
    }
    expect(readFileSync(join(root, "src/domain/execution/guard.ts"), "utf8")).toContain("PHASE3A_BROADCAST_DISABLED");
    expect(readFileSync(join(root, "src/lib/execution/submission.ts"), "utf8")).toMatch(/requireBroadcastRelease\(\);[\s\S]*broadcast-transaction/);
  });
});
