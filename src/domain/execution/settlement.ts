import { isAddress, sameAddress } from "@/domain/routing/identity";
import type { Address } from "@/types/route";
import type { ConfirmedTransaction, SettlementEvidence } from "@/types/execution";

export function deriveSettlement(receipt: ConfirmedTransaction, owner: Address, inputToken: Address, outputToken: Address): SettlementEvidence {
  if (!isAddress(owner) || receipt.status !== "CONFIRMED" || !sameAddress(receipt.from, owner)) throw new Error("CONFIRMED_RECEIPT_REQUIRED");
  const amountIn = receipt.tokenTransfers.filter(x => sameAddress(x.token, inputToken) && sameAddress(x.from, owner)).reduce((sum, x) => sum + BigInt(x.amountRaw), 0n);
  const amountOut = receipt.tokenTransfers.filter(x => sameAddress(x.token, outputToken) && sameAddress(x.to, owner)).reduce((sum, x) => sum + BigInt(x.amountRaw), 0n);
  if (amountIn <= 0n || amountOut <= 0n) throw new Error("SETTLEMENT_TRANSFER_MISSING");
  return { ...receipt, actualAmountInRaw: amountIn.toString(), actualAmountOutRaw: amountOut.toString(), outputToken, outputRecipient: owner };
}
