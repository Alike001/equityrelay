import { z } from "zod";
import { positiveDecimal } from "@/domain/exposure/decimal";
import { isAddress } from "@/domain/routing/identity";
import { SUPPORTED_UNDERLYINGS } from "@/domain/equities/registry";

export const BrowserIntentSchema = z.strictObject({
  underlying: z.enum(SUPPORTED_UNDERLYINGS), sourceRepresentation: z.literal("ondo"),
  amount: z.string().max(80).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(value => { try { positiveDecimal(value); return true; } catch { return false; } }),
  destination: z.literal("venus"), maxExposureLossBps: z.number().int().min(0).max(10000),
  takerAddress: z.string().refine(isAddress, "Enter a valid BSC address."),
});

// Readiness accepts an address only. Token identities and probe sizes are server owned.
export const ReadinessIntentSchema = z.strictObject({ address: z.string().refine(isAddress, "Enter a valid BSC address.") });
