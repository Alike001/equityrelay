import "server-only";
import { z } from "zod";
import { isAddress, sameAddress } from "@/domain/routing/identity";
import type { Address } from "@/types/route";
import type { ConfirmedTransaction, TransactionObservation } from "@/types/execution";
import { signedRequest } from "@/lib/binance/client";

const Hash = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const Transfer = z.object({ from: z.string(), to: z.string(), tokenContractAddress: z.string(), amount: z.string().regex(/^[1-9]\d*$/) });
const Detail = z.object({ chainIndex: z.union([z.string(), z.number()]), height: z.string().regex(/^[1-9]\d*$/), txTime: z.string().regex(/^\d+$/), txhash: Hash,
  txStatus: z.string(), fromDetails: z.array(z.object({ address: z.string() })).optional(), toDetails: z.array(z.object({ address: z.string() })).optional(), tokenTransferDetails: z.array(Transfer).optional() });

export function parseConfirmedBinanceDetail(data: unknown, hash: `0x${string}`, owner: Address, expectedTarget: Address): TransactionObservation {
  if (!Array.isArray(data) || data.length === 0) return { status: "PENDING", transactionHash: hash };
  const row = Detail.parse(data[0]);
  if (String(row.chainIndex) !== "56" || row.txhash.toLowerCase() !== hash.toLowerCase()) throw new Error("RECEIPT_IDENTITY_MISMATCH");
  if (row.txStatus.toLowerCase() === "failed") return { status: "FAILED", transactionHash: hash, reason: "Binance reported failed transaction status." };
  if (row.txStatus.toLowerCase() !== "success") return { status: "PENDING", transactionHash: hash };
  if (!row.fromDetails?.some(x => sameAddress(x.address, owner)) || !row.toDetails?.some(x => sameAddress(x.address, expectedTarget))) throw new Error("RECEIPT_PARTIES_UNVERIFIED");
  if (!Number.isFinite(Number(row.txTime)) || !Number.isFinite(Date.parse(new Date(Number(row.txTime)).toISOString()))) throw new Error("RECEIPT_TIME_INVALID");
  const confirmedAt = new Date().toISOString(); // Time success was observed; Binance txTime is not a confirmation timestamp.
  const tokenTransfers = (row.tokenTransferDetails ?? []).map(transfer => {
    if (!isAddress(transfer.from) || !isAddress(transfer.to) || !isAddress(transfer.tokenContractAddress)) throw new Error("INVALID_TRANSFER_EVIDENCE");
    return { token: transfer.tokenContractAddress, from: transfer.from, to: transfer.to, amountRaw: transfer.amount, logIndex: null };
  });
  const confirmed: ConfirmedTransaction = { status: "CONFIRMED", transactionHash: hash, blockNumber: row.height,
    from: owner, to: expectedTarget, tokenTransfers, confirmedAt };
  return confirmed;
}

export async function observeBinanceTransaction(hash: `0x${string}`, owner: Address, expectedTarget: Address): Promise<TransactionObservation> {
  if (!Hash.safeParse(hash).success || !isAddress(owner) || !isAddress(expectedTarget)) throw new Error("INVALID_RECEIPT_REQUEST");
  const data = await signedRequest("GET", "/api/v1/dex/post-transaction/transaction-detail-by-txhash", { params: { binanceChainId: "56", txHash: hash } });
  return parseConfirmedBinanceDetail(data, hash, owner, expectedTarget);
}
