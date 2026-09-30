import { describe, expect, it } from "vitest";
import { classifyLostHash, type RecoveryTransaction } from "./lost-hash";
import type { ExecutionActionV1 } from "./action";

const address = "0x1111111111111111111111111111111111111111" as const;
const target = "0x2222222222222222222222222222222222222222" as const;
const action: ExecutionActionV1 = { version: "ExecutionActionV1", routeId: "route", stage: "LEG1_SWAP", kind: "SWAP", chainId: 56,
  from: address, to: target, data: "0x12345678", valueWei: "0", tokenIn: address, tokenOut: target,
  amountInRaw: "1", approvalSpender: null, approvalAmountRaw: null, planIdentity: "quote", planRevision: "revision" };
const tx: RecoveryTransaction = { hash: `0x${"a".repeat(64)}`, from: address, to: target, input: action.data,
  value: 0n, chainId: 56, blockNumber: 100n };
describe("lost-hash candidate selection", () => {
  it("leaves zero matches unresolved and accepts only one exact semantic candidate", () => {
    expect(classifyLostHash(action, [])).toEqual({ status: "UNRESOLVED", reason: "NO_MATCH" });
    expect(classifyLostHash(action, [{ ...tx, to: address }])).toEqual({ status: "UNRESOLVED", reason: "NO_MATCH" });
    expect(classifyLostHash(action, [tx])).toMatchObject({ status: "CANDIDATE", hash: tx.hash, blockNumber: "100" });
  });
  it("fails closed for two matching transactions and changed calldata or native value", () => {
    expect(classifyLostHash(action, [tx, { ...tx, hash: `0x${"b".repeat(64)}` }])).toMatchObject({ status: "AMBIGUOUS", matches: 2 });
    expect(classifyLostHash(action, [{ ...tx, input: "0xdeadbeef" }, { ...tx, value: 1n }])).toMatchObject({ status: "UNRESOLVED" });
  });
});
