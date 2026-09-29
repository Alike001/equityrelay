import Decimal from "decimal.js";
import { isAddress, sameAddress } from "@/domain/routing/identity";
import type { Address } from "@/types/route";
import type { ProofAsset, WalletAssetBalance, WalletReadiness } from "@/types/readiness";

const nonnegativeDecimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const rawInteger = /^(?:0|[1-9]\d*)$/;

export function parseRequestedBalances(data: unknown, owner: Address, requested: Record<ProofAsset, Address | "">): WalletReadiness {
  if (!Array.isArray(data)) throw new Error("INVALID_BALANCE_RESPONSE");
  const known = new Map<string, ProofAsset>(Object.entries(requested).map(([asset, address]) => [address.toLowerCase(), asset as ProofAsset]));
  const assets = {} as Record<ProofAsset, WalletAssetBalance>;
  for (const asset of Object.keys(requested) as ProofAsset[]) assets[asset] = { asset, balance: "0", rawBalance: "0", reported: false };
  for (const group of data) {
    if (!group || typeof group !== "object" || !Array.isArray(group.tokenAssets)) throw new Error("INVALID_BALANCE_RESPONSE");
    for (const row of group.tokenAssets) {
      if (!row || typeof row !== "object" || row.binanceChainId !== "56" || typeof row.tokenContractAddress !== "string") throw new Error("INVALID_BALANCE_RESPONSE");
      const asset = known.get(row.tokenContractAddress.toLowerCase());
      if (!asset) continue; // Never disclose an unrelated asset returned by the service.
      if ((row.address && (!isAddress(row.address) || !sameAddress(row.address, owner))) || assets[asset].reported ||
          typeof row.balance !== "string" || !nonnegativeDecimal.test(row.balance) ||
          (row.rawBalance !== undefined && row.rawBalance !== "" && (typeof row.rawBalance !== "string" || !rawInteger.test(row.rawBalance)))) throw new Error("INVALID_BALANCE_RESPONSE");
      const balance = new Decimal(row.balance);
      if (!balance.isFinite() || balance.lt(0)) throw new Error("INVALID_BALANCE_RESPONSE");
      assets[asset] = { asset, balance: balance.toFixed(), rawBalance: row.rawBalance && row.rawBalance !== "" ? row.rawBalance : null, reported: true };
    }
  }
  return { walletShort: `${owner.slice(0, 6)}…${owner.slice(-4)}`, assets, observedAt: new Date().toISOString() };
}
