# EquityRelay Developer Experience Log

Append genuine findings as implementation proceeds. The entry below is pre-build research evidence, not an issue discovered during this application build.

## Pre-build research evidence

### 2026-09-29 — Direct cross-issuer quote rejected

- **API / surface:** Binance Web3 Trading API aggregator quote.
- **Attempt:** Quote direct NVDAon → NVDAB at approximately $10, $100, and $500 on BSC.
- **Expected:** The aggregator might route internally through an allowed stable asset.
- **Actual:** Each direct quote returned HTTP 200 with business code `40368`. Explicit NVDAon → USDT → NVDAB quotes succeeded at all three sizes.
- **Error/code:** `40368`: `Ondo asset on chain 56 can only pair with allowed stablecoin(s)`.
- **Impact:** The route must explicitly include an allowed settlement asset.
- **Workaround:** Compile NVDAon → USDT → NVDAB as two bounded legs.
- **Suggested improvement:** Expose allowed settlement assets in RWA metadata so route builders can discover valid paths before quoting.
- **Evidence:** [Feasibility result](docs/context/FEASIBILITY_RESULT_2026-09-29.md).
