import Decimal from "decimal.js";

Decimal.set({ precision: 80, rounding: Decimal.ROUND_DOWN });

export function positiveDecimal(value: string): Decimal {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("INVALID_DECIMAL");
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || !parsed.gt(0)) throw new Error("INVALID_DECIMAL");
  return parsed;
}

export function validDecimals(value: unknown): number {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 36) throw new Error("INVALID_DECIMALS");
  return n;
}

export function toRawUnits(amount: string, decimals: number): string {
  validDecimals(decimals);
  positiveDecimal(amount);
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > decimals) throw new Error("AMOUNT_PRECISION_EXCEEDED");
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction.padEnd(decimals, "0") || "0"));
  if (raw <= 0n) throw new Error("ZERO_RAW_AMOUNT");
  return raw.toString();
}

export function rawToDecimal(raw: string, decimals: number): Decimal {
  validDecimals(decimals);
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) throw new Error("INVALID_RAW_AMOUNT");
  return new Decimal(raw).div(new Decimal(10).pow(decimals));
}

export function normalizedShares(raw: string, decimals: number, ratio: string): Decimal {
  return rawToDecimal(raw, decimals).mul(positiveDecimal(ratio));
}

export function decimalText(value: Decimal): string {
  return value.toFixed();
}
