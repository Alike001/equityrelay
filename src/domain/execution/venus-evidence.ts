import { decodeEventLog, decodeFunctionData, erc20Abi, parseAbi, type Hex } from "viem";
import { sameAddress } from "@/domain/routing/identity";
import type { Address } from "@/types/route";

// Venus Core VTokenInterfaces.sol declares a four-field Mint event. The live
// vNVDAB market must still be matched to a historical successful supply before release.
export const venusMintAbi = parseAbi(["event Mint(address minter, uint256 mintAmount, uint256 mintTokens, uint256 totalSupply)",
  "function mint(uint256 mintAmount) returns (uint256)"]);

type ReceiptLog = { address: Address; data: Hex; topics: readonly Hex[] };
export function inspectVenusSupply(input: { wallet: Address; underlying: Address; market: Address; amountRaw: string;
  calldata: Hex; logs: ReceiptLog[] }): { status: "EVIDENCE_MATCHED" | "NOT_READY"; mintedVTokensRaw?: string; reason?: string } {
  let requested: bigint;
  try {
    const decoded = decodeFunctionData({ abi: venusMintAbi, data: input.calldata });
    if (decoded.functionName !== "mint") return { status: "NOT_READY", reason: "VENUS_MINT_CALL_NOT_IDENTIFIED" };
    requested = decoded.args[0];
  } catch { return { status: "NOT_READY", reason: "VENUS_MINT_CALL_NOT_IDENTIFIED" }; }
  if (requested.toString() !== input.amountRaw || requested <= 0n) return { status: "NOT_READY", reason: "VENUS_MINT_AMOUNT_MISMATCH" };
  const mints: Array<{ amount: bigint; tokens: bigint }> = [];
  const underlyingTransfers: bigint[] = [], vTokenTransfers: bigint[] = [];
  for (const log of input.logs) {
    try {
      if (log.topics.length === 0) continue;
      if (sameAddress(log.address, input.market)) {
        const event = decodeEventLog({ abi: venusMintAbi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
        if (event.eventName === "Mint" && sameAddress(event.args.minter, input.wallet))
          mints.push({ amount: event.args.mintAmount, tokens: event.args.mintTokens });
      }
    } catch { /* Other market events are not supply evidence. */ }
    try {
      if (log.topics.length === 0) continue;
      const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
      if (event.eventName !== "Transfer") continue;
      if (sameAddress(log.address, input.underlying) && sameAddress(event.args.from, input.wallet) && sameAddress(event.args.to, input.market))
        underlyingTransfers.push(event.args.value);
      if (sameAddress(log.address, input.market) && sameAddress(event.args.from, input.market) && sameAddress(event.args.to, input.wallet))
        vTokenTransfers.push(event.args.value);
    } catch { /* Other logs are not supply evidence. */ }
  }
  if (mints.length !== 1 || underlyingTransfers.length !== 1 || vTokenTransfers.length !== 1 ||
      mints[0].amount !== requested || underlyingTransfers[0] !== requested ||
      mints[0].tokens <= 0n || vTokenTransfers[0] !== mints[0].tokens)
    return { status: "NOT_READY", reason: "VENUS_SUPPLY_EVIDENCE_MISSING_OR_AMBIGUOUS" };
  return { status: "EVIDENCE_MATCHED", mintedVTokensRaw: mints[0].tokens.toString() };
}
