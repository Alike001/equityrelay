import { connectedWalletMatchesSession } from "@/domain/execution/wallet-binding";
import type { Eip1193Provider } from "./providers";

export const bscChainHex = "0x38";
export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function authenticateSelectedProvider(provider: Eip1193Provider, fetcher: Fetcher): Promise<string> {
  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
  const address = accounts[0];
  const chain = await provider.request({ method: "eth_chainId" }) as string;
  if (!address) throw new Error("No wallet account was selected.");
  if (chain.toLowerCase() !== bscChainHex) throw new Error("Switch to BNB Smart Chain to continue.");
  const challengeResponse = await fetcher("/api/auth/challenge", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: address }) });
  if (!challengeResponse.ok) throw new Error("Could not create a wallet authentication challenge.");
  const challenge = await challengeResponse.json() as { message: string };
  const signature = await provider.request({ method: "personal_sign", params: [challenge.message, address] }) as string;
  const response = await fetcher("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: challenge.message, signature }) });
  if (!response.ok) throw new Error("Wallet authentication failed or the challenge expired.");
  const session = await response.json() as { wallet: string };
  const [currentAccounts, currentChain] = await Promise.all([
    provider.request({ method: "eth_accounts" }), provider.request({ method: "eth_chainId" }),
  ]);
  if (!connectedWalletMatchesSession(session.wallet, currentAccounts, currentChain)) {
    await logoutEquityRelay(fetcher);
    throw new Error("Wallet or chain changed during authentication. Please try again.");
  }
  return session.wallet;
}

export async function validateSelectedProviderSession(provider: Eip1193Provider, wallet: string): Promise<boolean> {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: "eth_accounts" }), provider.request({ method: "eth_chainId" }),
  ]);
  return connectedWalletMatchesSession(wallet, accounts, chain);
}

export async function requestBscSwitch(provider: Eip1193Provider): Promise<void> {
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: bscChainHex }] });
}

export async function logoutEquityRelay(fetcher: Fetcher): Promise<void> {
  await fetcher("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
}
