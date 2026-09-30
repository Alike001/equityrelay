import { connectedWalletMatchesSession } from "@/domain/execution/wallet-binding";
import type { Eip1193Provider } from "./providers";

export const bscChainHex = "0x38";
export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type WalletPermissionState = "REVOKED" | "STILL_CONNECTED" | "UNKNOWN";
export type PermissionRevocationOutcome = "SUPPORTED_AND_REVOKED" | "REQUEST_ACCEPTED_NOT_REVOKED" |
  "METHOD_UNSUPPORTED" | "USER_REJECTED" | "PROVIDER_ERROR";
export type DisconnectResult = { sessionRevoked: boolean; permission: {
  outcome: PermissionRevocationOutcome; walletPermissionState: WalletPermissionState;
} };

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
  const response = await fetcher("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!response.ok) throw new Error("EQUITYRELAY_LOGOUT_UNAVAILABLE");
}

function providerError(error: unknown): { code?: number | string; message: string } {
  if (!error || typeof error !== "object") return { message: String(error) };
  const candidate = error as { code?: unknown; message?: unknown };
  return { ...(typeof candidate.code === "number" || typeof candidate.code === "string" ? { code: candidate.code } : {}),
    message: typeof candidate.message === "string" ? candidate.message : "" };
}

export async function revokeSelectedProviderPermission(provider: Eip1193Provider): Promise<DisconnectResult["permission"]> {
  try {
    await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch (error) {
    const { code, message } = providerError(error);
    if (code === 4001 || code === "4001" || /user (?:rejected|denied)|request rejected|cancelled/i.test(message))
      return { outcome: "USER_REJECTED", walletPermissionState: "UNKNOWN" };
    if (code === 4200 || code === "4200" || code === -32601 || code === "-32601" || /method (?:not found|not supported)|unsupported method/i.test(message))
      return { outcome: "METHOD_UNSUPPORTED", walletPermissionState: "UNKNOWN" };
    return { outcome: "PROVIDER_ERROR", walletPermissionState: "UNKNOWN" };
  }
  try {
    const accounts = await provider.request({ method: "eth_accounts" });
    if (!Array.isArray(accounts)) return { outcome: "PROVIDER_ERROR", walletPermissionState: "UNKNOWN" };
    return accounts.length === 0 ? { outcome: "SUPPORTED_AND_REVOKED", walletPermissionState: "REVOKED" } :
      { outcome: "REQUEST_ACCEPTED_NOT_REVOKED", walletPermissionState: "STILL_CONNECTED" };
  } catch { return { outcome: "PROVIDER_ERROR", walletPermissionState: "UNKNOWN" }; }
}

export async function disconnectSelectedProvider(provider: Eip1193Provider, fetcher: Fetcher): Promise<DisconnectResult> {
  let sessionRevoked = false;
  try { await logoutEquityRelay(fetcher); sessionRevoked = true; }
  catch { sessionRevoked = false; }
  const permission = await revokeSelectedProviderPermission(provider);
  return { sessionRevoked, permission };
}
