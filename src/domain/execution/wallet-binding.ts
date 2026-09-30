import { sameAddress } from "@/domain/routing/identity";

export function connectedWalletMatchesSession(sessionWallet: string | null, accounts: unknown, chainId: unknown): boolean {
  return !!sessionWallet && Array.isArray(accounts) && typeof accounts[0] === "string" &&
    sameAddress(sessionWallet, accounts[0]) && typeof chainId === "string" && chainId.toLowerCase() === "0x38";
}
