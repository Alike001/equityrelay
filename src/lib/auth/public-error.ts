export function publicAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return new Set(["EXECUTION_DATABASE_UNAVAILABLE", "PUBLIC_ORIGIN_UNAVAILABLE", "INVALID_PUBLIC_ORIGIN", "ORIGIN_MISMATCH",
    "CONTENT_TYPE_REQUIRED", "INVALID_WALLET_CLAIM", "INVALID_SIWE_CHALLENGE", "SIWE_CHALLENGE_EXPIRED_OR_USED",
    "SIWE_SIGNATURE_INVALID"]).has(message) ? message : "AUTH_UNAVAILABLE";
}
