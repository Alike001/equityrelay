export function mainnetExecutionArmed(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.EQUITYRELAY_MAINNET_EXECUTION === "true";
}

export function requireMainnetExecutionArm(environment: Record<string, string | undefined> = process.env): void {
  if (!mainnetExecutionArmed(environment)) throw new Error("MAINNET_EXECUTION_NOT_ARMED");
}

// Phase 3A hard stop: changing an environment variable alone cannot enable a broadcast.
export function requireBroadcastRelease(): never { throw new Error("PHASE3A_BROADCAST_DISABLED"); }
