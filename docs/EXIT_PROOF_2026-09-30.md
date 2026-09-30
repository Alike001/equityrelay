# EXIT PREFLIGHT RECORD — 2026-09-30

**READ-ONLY. NO FUNDS MOVED. NOT AN EXECUTION RECEIPT.**

This dated record verifies an indicative unwind for the first viable 0.022 NVDAon entry probe. A known public historical vNVDAB supplier was used only as address-specific read-only context because it had enough vNVDAB for Binance simulation. It is not presented as the EquityRelay user or as an EquityRelay execution.

## Entry observation

- `0.021 NVDAon`: Binance business code `40375`, minimum order amount is 5 USD.
- `0.022 NVDAon`: route completed read-only.
- Leg 1 output: `5.017390844052525749 USDT`.
- Leg 2 output: `0.02202185420972685 NVDAB`.
- NVIDIA-equivalent retention: `100.005702338352623...%`.
- Policy at maximum exposure reduction 0.50%: `PASS`.
- Venus investment: live and investable.
- Deposit build: `READY`; simulation remained wallet-state blocked with `40484` because the quote context did not own the indicative NVDAB.
- Setup quote: `5.029934321162657063 USDT → 0.022050599711183828 NVDAon`.

These values are observations, not fixtures for live mode.

## Exit observation

The current Binance DeFi builder accepted the same live Venus investment and exact indicative underlying amount at `/api/v1/defi/transaction/redeem` with `simulate=true`.

- Requested underlying: `0.02202185420972685 NVDAB`.
- Returned action: one `REDEEM`; no approval.
- Target: live vNVDAB market `0xEb8Ca841cBe1BC4832A10b15c7dAB1081eDaD371`.
- Native value: zero.
- Calldata: `redeem(uint256)`, selector `0xdb006a75`.
- vNVDAB input: `2202185` raw units.
- Canonical `exchangeRateStored`: `10000000018667150604327047777`.
- The exact floor conversion `underlyingRaw × 10^18 ÷ exchangeRateStored` equals the returned `2202185` raw vNVDAB.
- Simulation: `PASSED`.
- Previewed underlying received: `0.022021850041108519 NVDAB`.
- Redemption delay: none (`[]`).
- Exchange-rate-derived underlying available to quote: `0.022021850041108519 NVDAB`.
- Indicative `NVDAB → USDT` quote: `5.026662606796302815 USDT`.

The exit value is not guaranteed. NVIDIA's market price, representation ratios, spread, slippage, gas, protocol liquidity, market conditions, and Venus exchange rate can change. A future exit must rediscover the investment, rebuild the redeem, validate current state, and request a fresh NVDAB → USDT quote.

## Technical cost boundary

Current entry build estimates covered `1,003,810` gas units before the deposit. The historical canonical NVDAB supply used `282,660` gas, giving an evidence-based indicative entry total of `1,286,470` gas units. Separate source setup actions estimated `496,600` gas units. At the observed Binance medium gas price of `58,197,827` wei, the combined estimate is approximately `0.00010377079938889 BNB`.

This is an estimate, not a reserve guarantee. Capital remains represented as NVDAon, USDT, NVDAB/vNVDAB, and any residual source amount. Likely consumed costs are gas plus realized spread, slippage, and fees. Principal recovery is not guaranteed.
