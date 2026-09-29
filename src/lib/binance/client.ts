import "server-only";
import { createHmac } from "node:crypto";

const HOST = "https://web3.binance.com";
const PREFIX = "/build";

export class BinanceApiError extends Error {
  constructor(public readonly path: string, public readonly status: number, public readonly businessCode: string, message: string) {
    super(message);
  }
}

function queryString(params: Record<string, string> = {}): string {
  const entries = Object.entries(params).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return entries.length ? `?${entries.join("&")}` : "";
}

export async function signedRequest(method: "GET" | "POST", path: string, options: { params?: Record<string, string>; body?: unknown } = {}): Promise<unknown> {
  const key = process.env.BINANCE_W3_API_KEY;
  const secret = process.env.BINANCE_W3_API_SECRET;
  if (!key || !secret) throw new BinanceApiError(path, 0, "CONFIG_MISSING", "Binance API is not configured on this server.");
  const wirePath = `${PREFIX}${path}${queryString(options.params)}`;
  const body = options.body === undefined ? "" : JSON.stringify(options.body);
  const timestamp = new Date().toISOString();
  // Matches the successful 2026-09-29 feasibility harness: timestamp + method + /build path/query + JSON body.
  const signature = createHmac("sha256", secret).update(timestamp + method + wirePath + body, "utf8").digest("base64");
  let response: Response;
  try {
    response = await fetch(`${HOST}${wirePath}`, {
      method,
      headers: {
        "X-OC-APIKEY": key,
        "X-OC-TIMESTAMP": timestamp,
        "X-OC-SIGN": signature,
        "X-OC-RECV-WINDOW": "20000",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
      cache: "no-store",
    });
  } catch {
    throw new BinanceApiError(path, 0, "NETWORK", "Binance API request could not be completed.");
  }
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new BinanceApiError(path, response.status, "MALFORMED_RESPONSE", "Binance API returned an unreadable response."); }
  const envelope = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const code = String(envelope.code ?? "0");
  if (!response.ok || code !== "0") {
    const message = typeof envelope.msg === "string" ? envelope.msg.slice(0, 200) : "Binance API returned an error.";
    throw new BinanceApiError(path, response.status, code, message);
  }
  return envelope.data ?? payload;
}
