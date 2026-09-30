# TEST SETUP — NOT PART OF EQUITYRELAY ROUTE

The Phase 2C quote wallet had no relevant BSC balances. A later read-only minimum-size probe found a smaller setup quote: `5.029934321162657063 USDT → 0.022050599711183828 NVDAon`, enough for the first viable 0.022 NVDAon route observed on 2026-09-30. This is dated quote evidence, not a purchase instruction. It still exceeds the project's hard $2 total mainnet-spending limit and must not be executed under that budget.

The EquityRelay product route begins only after the user already holds NVDAon: NVDAon → USDT → NVDAB → Venus. Test setup must never be bundled into the three product confirmation boundaries.

Live Binance evidence returned business code `40375: Minimum order amount is 5 USD` for 0.005, 0.01, 0.02 and 0.021 NVDAon. The next tested size, 0.022 NVDAon, completed both route quotes, passed the 0.50% exposure policy, and produced a read-only Venus deposit build. It remains above the $2 budget. Orders must not be split to bypass the platform minimum. A funded mainnet execution is therefore not a release requirement unless later evidence discovers a legitimate route within $2 without weakening the product or bypassing platform rules.

The competition build uses live read-only Binance route evidence, live unsigned transaction builds, live simulations, and historical canonical Venus verification. It makes no fabricated execution claim. No funding, acquisition, signing, approval or submission procedure is enabled.
