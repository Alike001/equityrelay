import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, parseAbiParameters, type Hex } from "viem";
import { NVDAB_ADDRESS } from "@/domain/routing/identity";
import { inspectVenusSupply, venusMintAbi } from "./venus-evidence";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const market = "0xEb8Ca841cBe1BC4832A10b15c7dAB1081eDaD371" as const;
const amount = 5n, tokens = 2n;
const calldata = encodeFunctionData({ abi: venusMintAbi, functionName: "mint", args: [amount] });
const transfer = (token: typeof NVDAB_ADDRESS | typeof market, from: string, to: string, value: bigint) => ({ address: token,
  topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: from as `0x${string}`, to: to as `0x${string}` } }).filter((x): x is Hex => typeof x === "string"),
  data: encodeAbiParameters(parseAbiParameters("uint256"), [value]) });
const mint = { address: market, topics: encodeEventTopics({ abi: venusMintAbi, eventName: "Mint" }).filter((x): x is Hex => typeof x === "string"),
  data: encodeAbiParameters(parseAbiParameters("address,uint256,uint256,uint256"), [wallet,amount,tokens,10n]) };
const logs = [transfer(NVDAB_ADDRESS,wallet,market,amount),mint,transfer(market,market,wallet,tokens)];
describe("Venus vToken supply evidence", () => {
  it("requires four-field Mint, matching underlying transfer and matching vToken mint", () => {
    expect(inspectVenusSupply({ wallet, underlying: NVDAB_ADDRESS, market, amountRaw: "5", calldata, logs })).toEqual({ status: "EVIDENCE_MATCHED", mintedVTokensRaw: "2" });
    expect(inspectVenusSupply({ wallet, underlying: NVDAB_ADDRESS, market, amountRaw: "5", calldata, logs: logs.slice(0,2) }).status).toBe("NOT_READY");
    expect(inspectVenusSupply({ wallet, underlying: NVDAB_ADDRESS, market, amountRaw: "6", calldata, logs }).status).toBe("NOT_READY");
    expect(inspectVenusSupply({ wallet, underlying: NVDAB_ADDRESS, market, amountRaw: "5", calldata, logs: [...logs,mint] }).status).toBe("NOT_READY");
  });
});
