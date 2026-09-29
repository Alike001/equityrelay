import { z } from "zod";
import { positiveDecimal } from "@/domain/exposure/decimal";
import { isAddress } from "@/domain/routing/identity";

export const BrowserIntentSchema = z.strictObject({
  underlying: z.literal("NVDA"), sourceRepresentation: z.literal("ondo"),
  amount: z.string().max(80).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(value => { try { positiveDecimal(value); return true; } catch { return false; } }),
  destination: z.literal("venus"), maxExposureLossBps: z.number().int().min(0).max(10000),
  takerAddress: z.string().refine(isAddress, "Enter a valid BSC address."),
});
