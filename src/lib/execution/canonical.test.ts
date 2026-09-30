import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeEventTopics, encodeAbiParameters, erc20Abi, type Hex } from "viem";
import { NVDAON_ADDRESS, USDT_ADDRESS } from "@/domain/routing/identity";
import type { ExecutionActionV1 } from "@/domain/execution/action";
import historicalVenus from "@/domain/execution/fixtures/venus-nvdab-mint-mainnet.json";
import { NVDAB_ADDRESS, VENUS_VNVDAB_ADDRESS } from "@/domain/routing/identity";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/execution/rpc", () => ({ bscPublicClient: vi.fn(), readBscWithRetry: (read: () => Promise<unknown>) => read() }));
import { bscPublicClient } from "@/lib/execution/rpc";
import { decodeTransfers, exactSettlementFromTransfers, finalityPolicy, hasExactApprovalLog, observeCanonicalTransaction } from "./canonical";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const router = "0x2222222222222222222222222222222222222222" as const;
const txHash = `0x${"a".repeat(64)}` as Hex;
const blockHash = `0x${"b".repeat(64)}` as Hex;
const action: ExecutionActionV1 = { version: "ExecutionActionV1", routeId: "route", stage: "LEG1_SWAP", kind: "SWAP", chainId: 56,
  from: wallet, to: router, data: "0x12345678", valueWei: "0", tokenIn: NVDAON_ADDRESS, tokenOut: USDT_ADDRESS,
  amountInRaw: "5", approvalSpender: null, approvalAmountRaw: null, planIdentity: "quote", planRevision: "initial" };
function transfer(token: `0x${string}`, from: `0x${string}`, to: `0x${string}`, amount: bigint, logIndex: number) {
  return { address: token, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]), logIndex };
}
describe("canonical evidence", () => {
  it("extracts only unique expected wallet transfers with exact integer amounts", () => {
    const transfers = decodeTransfers([transfer(NVDAON_ADDRESS, wallet, router, 5n, 0), transfer(USDT_ADDRESS, router, wallet, 11n, 1)]);
    expect(exactSettlementFromTransfers({ transfers, wallet, tokenIn: NVDAON_ADDRESS, tokenOut: USDT_ADDRESS })).toMatchObject({ amountInRaw: "5", amountOutRaw: "11" });
    expect(() => exactSettlementFromTransfers({ transfers: [...transfers, transfers[1]], wallet, tokenIn: NVDAON_ADDRESS, tokenOut: USDT_ADDRESS })).toThrow("SETTLEMENT_LOGS_MISSING_OR_AMBIGUOUS");
    expect(() => exactSettlementFromTransfers({ transfers: transfers.slice(0, 1), wallet, tokenIn: NVDAON_ADDRESS, tokenOut: USDT_ADDRESS })).toThrow("SETTLEMENT_LOGS_MISSING_OR_AMBIGUOUS");
  });
  it("uses a configurable conservative confirmation policy", () => {
    expect(finalityPolicy({})).toEqual({ minConfirmations: 3n, requireFinalized: false });
    expect(finalityPolicy({ BSC_MIN_CONFIRMATIONS: "5", BSC_REQUIRE_FINALIZED: "true" })).toEqual({ minConfirmations: 5n, requireFinalized: true });
    expect(() => finalityPolicy({ BSC_MIN_CONFIRMATIONS: "0" })).toThrow("INVALID_FINALITY_POLICY");
  });
});

describe("RPC receipt gate", () => {
  const client = { getChainId: vi.fn(), getTransaction: vi.fn(), getTransactionReceipt: vi.fn(), getBlock: vi.fn(), getBlockNumber: vi.fn(), readContract: vi.fn() };
  beforeEach(() => {
    vi.mocked(bscPublicClient).mockReturnValue(client as unknown as ReturnType<typeof bscPublicClient>);
    client.getChainId.mockResolvedValue(56);
    client.getTransaction.mockResolvedValue({ from: wallet, to: router, input: action.data, value: 0n, chainId: 56, gas: 300000n,
      nonce: 9, gasPrice: 1000000000n, blockHash, blockNumber: 100n });
    client.getTransactionReceipt.mockResolvedValue({ status: "success", from: wallet, to: router, blockHash, blockNumber: 100n,
      effectiveGasPrice: 1000000000n, logs: [transfer(NVDAON_ADDRESS, wallet, router, 5n, 0), transfer(USDT_ADDRESS, router, wallet, 11n, 1)] });
    client.getBlock.mockResolvedValue({ hash: blockHash, number: 100n, timestamp: 1000n });
    client.getBlockNumber.mockResolvedValue(102n);
  });
  it("treats tx hash as a lookup hint and records wallet-selected nonce/gas separately", async () => {
    const result = await observeCanonicalTransaction(txHash, action);
    expect(result).toMatchObject({ status: "CONFIRMED", settlement: { amountInRaw: "5", amountOutRaw: "11" }, gas: { nonce: 9, gasLimit: "300000" } });
    client.getTransaction.mockResolvedValueOnce({ from: wallet, to: USDT_ADDRESS, input: action.data, value: 0n, chainId: 56 });
    await expect(observeCanonicalTransaction(txHash, action)).resolves.toMatchObject({ status: "FAILED", reason: "CANONICAL_ACTION_MISMATCH" });
  });
  it("stays pending without required depth and fails on missing or ambiguous settlement", async () => {
    client.getBlockNumber.mockResolvedValueOnce(100n);
    await expect(observeCanonicalTransaction(txHash, action)).resolves.toMatchObject({ status: "PENDING", reason: "CONFIRMATIONS_PENDING" });
    client.getTransactionReceipt.mockResolvedValueOnce({ status: "success", from: wallet, to: router, blockHash, blockNumber: 100n, logs: [] });
    await expect(observeCanonicalTransaction(txHash, action)).resolves.toMatchObject({ status: "FAILED", reason: "SETTLEMENT_EVIDENCE_MISSING" });
  });
  it("does not claim finalized when configured RPC finality is behind or unavailable", async () => {
    const old = process.env.BSC_REQUIRE_FINALIZED;
    try {
      process.env.BSC_REQUIRE_FINALIZED = "true";
      client.getBlock.mockResolvedValueOnce({ hash: blockHash, number: 100n, timestamp: 1000n })
        .mockResolvedValueOnce({ number: 99n });
      await expect(observeCanonicalTransaction(txHash, action)).resolves.toMatchObject({ status: "PENDING", reason: "FINALITY_PENDING" });
      client.getBlock.mockResolvedValueOnce({ hash: blockHash, number: 100n, timestamp: 1000n }).mockRejectedValueOnce(new Error("unsupported finalized"));
      await expect(observeCanonicalTransaction(txHash, action)).resolves.toMatchObject({ status: "PENDING", reason: "FINALITY_PENDING" });
    } finally { if (old === undefined) delete process.env.BSC_REQUIRE_FINALIZED; else process.env.BSC_REQUIRE_FINALIZED = old; }
  });
  it("rejects receipt revert, wrong chain, and conflicting block", async () => {
    client.getTransactionReceipt.mockResolvedValueOnce({ status: "reverted", from: wallet, to: router, blockHash, blockNumber: 100n });
    await expect(observeCanonicalTransaction(txHash, action)).resolves.toMatchObject({ status: "FAILED", reason: "RECEIPT_REVERTED" });
    client.getChainId.mockResolvedValueOnce(1);
    await expect(observeCanonicalTransaction(txHash, action)).rejects.toThrow("WRONG_RPC_CHAIN");
    client.getBlock.mockResolvedValueOnce({ hash: txHash, number: 100n, timestamp: 1000n });
    await expect(observeCanonicalTransaction(txHash, action)).resolves.toMatchObject({ status: "FAILED", reason: "BLOCK_IDENTITY_MISMATCH" });
  });
  it("confirms Venus only from canonical supply events and block-specific position evidence", async () => {
    const venusAction: ExecutionActionV1 = { ...action, routeId: "venus-route", stage: "VENUS_DEPOSIT", kind: "DEPOSIT",
      from: historicalVenus.transaction.from as `0x${string}`, to: VENUS_VNVDAB_ADDRESS,
      data: historicalVenus.transaction.input as Hex, tokenIn: NVDAB_ADDRESS, tokenOut: null,
      amountInRaw: "1099946467462607788", planIdentity: "live-venus-investment" };
    client.getTransaction.mockResolvedValueOnce({ from: venusAction.from, to: venusAction.to, input: venusAction.data, value: 0n,
      chainId: 56, gas: 300000n, nonce: 10, gasPrice: 1000000000n,
      blockHash: historicalVenus.block.hash, blockNumber: BigInt(historicalVenus.block.number) });
    client.getTransactionReceipt.mockResolvedValueOnce({ status: "success", from: venusAction.from, to: venusAction.to,
      blockHash: historicalVenus.block.hash, blockNumber: BigInt(historicalVenus.block.number), effectiveGasPrice: 1000000000n,
      logs: historicalVenus.receipt.logs });
    client.getBlock.mockResolvedValueOnce({ hash: historicalVenus.block.hash, number: BigInt(historicalVenus.block.number), timestamp: BigInt(historicalVenus.block.timestamp) });
    client.getBlockNumber.mockResolvedValueOnce(BigInt(historicalVenus.block.number) + 2n);
    client.readContract.mockImplementation(({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
      if (functionName === "underlying") return Promise.resolve(NVDAB_ADDRESS);
      if (functionName === "symbol") return Promise.resolve("vNVDAB");
      if (functionName === "implementation") return Promise.resolve(historicalVenus.marketIdentity.implementationObservedAtValidation);
      if (functionName === "getAccountSnapshot") return Promise.resolve(historicalVenus.position.accountSnapshotAfter.map(BigInt));
      if (functionName === "balanceOf" && blockNumber === BigInt(historicalVenus.position.beforeBlock)) {
        return Promise.resolve(BigInt(historicalVenus.position.receiverVTokenBalanceBeforeRaw));
      }
      if (functionName === "balanceOf" && blockNumber === BigInt(historicalVenus.position.afterBlock)) {
        return Promise.resolve(BigInt(historicalVenus.position.receiverVTokenBalanceAfterRaw));
      }
      throw new Error("unexpected read");
    });
    // Underlying balance reads share balanceOf; return them in the last two call slots.
    client.readContract.mockImplementationOnce(async () => NVDAB_ADDRESS)
      .mockImplementationOnce(async () => "vNVDAB")
      .mockImplementationOnce(async () => historicalVenus.marketIdentity.implementationObservedAtValidation)
      .mockImplementationOnce(async () => BigInt(historicalVenus.position.receiverVTokenBalanceBeforeRaw))
      .mockImplementationOnce(async () => BigInt(historicalVenus.position.receiverVTokenBalanceAfterRaw))
      .mockImplementationOnce(async () => historicalVenus.position.accountSnapshotAfter.map(BigInt))
      .mockImplementationOnce(async () => BigInt(historicalVenus.position.marketUnderlyingBalanceBeforeRaw))
      .mockImplementationOnce(async () => BigInt(historicalVenus.position.marketUnderlyingBalanceAfterRaw));
    await expect(observeCanonicalTransaction(historicalVenus.transaction.hash as Hex, venusAction)).resolves.toMatchObject({
      status: "CONFIRMED", venusSupply: { eventType: "Mint", supplier: venusAction.from,
        underlyingAmountRaw: venusAction.amountInRaw, vTokensMintedRaw: "109994646" },
    });
  });
  it("requires exact Approval event from token, wallet and spender", () => {
    const approval: ExecutionActionV1 = { ...action, stage: "LEG1_APPROVAL", kind: "APPROVAL", to: NVDAON_ADDRESS,
      approvalSpender: router, approvalAmountRaw: "5" };
    const log = { address: NVDAON_ADDRESS, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Approval",
      args: { owner: wallet, spender: router } }) as Hex[], data: encodeAbiParameters([{ type: "uint256" }], [5n]) };
    expect(hasExactApprovalLog([log], approval)).toBe(true);
    expect(hasExactApprovalLog([{ ...log, address: USDT_ADDRESS }], approval)).toBe(false);
    expect(hasExactApprovalLog([log], { ...approval, approvalAmountRaw: "6" })).toBe(false);
  });
});
