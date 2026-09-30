# TEST SETUP — NOT PART OF EQUITYRELAY ROUTE

The Phase 2C quote wallet had no relevant BSC balances. A later read-only minimum-size probe found a smaller setup quote: `5.029934321162657063 USDT → 0.022050599711183828 NVDAon`, enough for the first viable 0.022 NVDAon route observed on 2026-09-30. A later observation required `5.052468020662069547 USDT → 0.022048259427323717 NVDAon`. These are dated quote observations, not purchase instructions.

The EquityRelay product route begins only after the user already holds NVDAon: NVDAon → USDT → NVDAB → Venus. Test setup must never be bundled into the three product confirmation boundaries.

Live Binance evidence returned business code `40375: Minimum order amount is 5 USD` for 0.005, 0.01, 0.02 and 0.021 NVDAon. The next tested size, 0.022 NVDAon, completed both route quotes, passed the 0.50% exposure policy, and produced a read-only Venus deposit build. The former $2 planning cap is no longer the active assumption. Orders must not be split to bypass the platform minimum, and every setup quote must be refreshed before a separate funding decision.

The competition build uses live read-only Binance route evidence, live unsigned transaction builds, live simulations, and historical canonical Venus verification. It makes no fabricated execution claim. No funding, acquisition, signing, approval or submission procedure is enabled.
