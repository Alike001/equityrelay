import { equityConfig, type SupportedUnderlying } from "@/domain/equities/registry";
import { sameAddress, USDT_ADDRESS } from "@/domain/routing/identity";
import type { ExecutionActionV1 } from "./action";

type ExpectedIdentity = { tokenIn: string; tokenOut: string | null; target?: string; approvalSpender?: string };

function expectedIdentity(underlying: SupportedUnderlying, stage: ExecutionActionV1["stage"]): ExpectedIdentity {
  const config = equityConfig(underlying);
  switch (stage) {
    case "TEST_SETUP_APPROVAL": return { tokenIn: USDT_ADDRESS, tokenOut: null };
    case "TEST_SETUP_SWAP": return { tokenIn: USDT_ADDRESS, tokenOut: config.sourceAddress };
    case "LEG1_APPROVAL": return { tokenIn: config.sourceAddress, tokenOut: null };
    case "LEG1_SWAP": return { tokenIn: config.sourceAddress, tokenOut: USDT_ADDRESS };
    case "LEG2_APPROVAL": return { tokenIn: USDT_ADDRESS, tokenOut: null };
    case "LEG2_SWAP": return { tokenIn: USDT_ADDRESS, tokenOut: config.targetAddress };
    case "VENUS_APPROVAL": return { tokenIn: config.targetAddress, tokenOut: null, target: config.targetAddress,
      approvalSpender: config.venusMarketAddress };
    case "VENUS_DEPOSIT": return { tokenIn: config.targetAddress, tokenOut: null, target: config.venusMarketAddress };
    case "VENUS_REDEEM": return { tokenIn: config.venusMarketAddress, tokenOut: config.targetAddress, target: config.venusMarketAddress };
    case "EXIT_APPROVAL": return { tokenIn: config.targetAddress, tokenOut: null };
    case "EXIT_SWAP": return { tokenIn: config.targetAddress, tokenOut: USDT_ADDRESS };
  }
}

// Durable actions remain server-authored, but this second binding prevents a
// stored action for one allowlisted asset from being delivered or reconciled
// as evidence for another route.
export function assertActionMatchesEquity(underlying: SupportedUnderlying, action: ExecutionActionV1): void {
  const expected = expectedIdentity(underlying, action.stage);
  if (!sameAddress(action.tokenIn, expected.tokenIn) ||
      (expected.tokenOut === null ? action.tokenOut !== null : !action.tokenOut || !sameAddress(action.tokenOut, expected.tokenOut)) ||
      (expected.target && !sameAddress(action.to, expected.target)) ||
      (expected.approvalSpender && (!action.approvalSpender || !sameAddress(action.approvalSpender, expected.approvalSpender))))
    throw new Error("CROSS_ASSET_ACTION_MISMATCH");
}
