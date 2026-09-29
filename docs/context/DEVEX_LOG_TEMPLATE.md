# EquityRelay Developer Experience Log

Do not rewrite this from memory later. Append entries as work happens.

## Entry template

### YYYY-MM-DD HH:MM — short title

- **API / surface:**
- **Attempt:**
- **Expected:**
- **Actual:**
- **Error/code:**
- **Impact:**
- **Workaround:**
- **Suggested improvement:**
- **Evidence:** commit / screenshot / sanitized response / report path

---

## Seed finding — direct cross-issuer pair rejected

### 2026-09-29 — NVDAon -> NVDAB direct quote

- **API / surface:** Binance Web3 Trading API aggregator quote.
- **Attempt:** Quote direct NVDAon -> NVDAB at approximately $10, $100 and $500 using a controlled BSC taker address.
- **Expected:** The aggregator might internally route the cross-issuer conversion through an allowed intermediate asset.
- **Actual:** All direct attempts were rejected at the business-rule layer.
- **Error/code:** HTTP 200, business code `40368`: `Ondo asset on chain 56 can only pair with allowed stablecoin(s)`.
- **Impact:** A generic token graph is incorrect for tokenized equities; issuer-specific settlement constraints must be represented explicitly.
- **Workaround:** Compile two bounded legs: NVDAon -> USDT, then USDT -> NVDAB. This route quoted successfully at all three tested sizes.
- **Suggested improvement:** Expose each RWA representation's allowed settlement assets in RWA metadata so route builders can construct valid graphs before the quote call.
- **Evidence:** `nvda-destination-feasibility.md` / `FEASIBILITY_RESULT_2026-09-29.md`.
