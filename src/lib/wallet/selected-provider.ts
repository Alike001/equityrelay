import type { WalletProviderOption } from "./providers";

// Browser-memory reference only. Provider objects cannot be serialized and the
// persisted provider metadata is never treated as wallet authority.
let current: WalletProviderOption | null = null;

export function setSelectedWalletProvider(option: WalletProviderOption | null): void {
  current = option;
}

export function getSelectedWalletProvider(): WalletProviderOption | null {
  return current;
}

