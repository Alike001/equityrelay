# TEST SETUP — NOT PART OF EQUITYRELAY ROUTE

The Phase 2C quote wallet had no relevant BSC balances. A read-only feasibility check found that USDT → NVDAon was quotable as a separate setup path, but the observed quote required about 11.95 USDT. It must not be executed under the project's hard $2 total mainnet-spending limit.

The EquityRelay product route begins only after the user already holds NVDAon: NVDAon → USDT → NVDAB → Venus. Test setup must never be bundled into the three product confirmation boundaries.

Live Binance evidence returned business code `40375: Minimum order amount is 5 USD` for 0.005, 0.01 and 0.02 NVDAon. The observed 0.05 NVDAon route was viable but materially exceeded the $2 budget. Orders must not be split to bypass the platform minimum. A funded mainnet execution is therefore not a release requirement unless later evidence discovers a legitimate route within $2 without weakening the product or bypassing platform rules.

The competition build uses live read-only Binance route evidence, live unsigned transaction builds, live simulations, and historical canonical Venus verification. It makes no fabricated execution claim. No funding, acquisition, signing, approval or submission procedure is enabled.
