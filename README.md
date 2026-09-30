# EquityRelay

**Own the stock. We handle the rail.**

EquityRelay is a destination router for NVIDIA tokenized stock on BNB Chain. Phase 1 previews `NVDAon → USDT → NVDAB → Venus` against a user exposure policy. Phase 2 builds and reviews unsigned transactions with exact bounded approvals. Phase 3 adds durable, authenticated execution preparation and canonical read-only verification. Mainnet execution remains blocked by both the environment guard and the Phase 3A code lock. Nothing is signed or broadcast.

## Run locally

1. Install Node.js 20.9 or newer and run `npm ci`.
2. Provision a PostgreSQL 16 or newer database. Set `DATABASE_URL` server-side and run `npm run migrate`. For a local rehearsal, a loopback-only Docker PostgreSQL instance is sufficient; PGlite is used only for isolated unit tests.
3. Create `.env.local` **in this repository** with `BINANCE_W3_API_KEY`, `BINANCE_W3_API_SECRET`, `DATABASE_URL`, `EQUITYRELAY_BSC_RPC_URL` and the exact `EQUITYRELAY_PUBLIC_ORIGIN`. Keep it local and ignored by Git. Do not copy the feasibility harness's secret file. Set `EQUITYRELAY_MAINNET_EXECUTION=false`.
4. Run `npm run dev` and open the configured origin.
5. Open `/app`, enter a human-readable NVDAon amount and a BSC address for quote context, set the maximum exposure reduction, then build the route. On `PASS`, select **Preflight route** to review unsigned actions. The address is used for read-only, potentially taker-specific quotes and simulations. The connected-wallet control signs only an authentication message; transaction controls remain disabled.

Without configured Binance credentials, the UI explicitly shows `UNAVAILABLE`.

## Verify

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The signed Binance client and response adapters follow the successful 2026-09-29 [feasibility result](docs/context/FEASIBILITY_RESULT_2026-09-29.md) and the read-only harness source. The [feasibility evidence page](/proof/feasibility) labels historical quote observations and does not claim execution.

## Phase 3C deployment rehearsal

- Apply `npm run migrate` to the intended managed PostgreSQL database during deployment. Migrations are serialized with a PostgreSQL advisory transaction lock and recorded in `schema_migrations`. `npm run migrate:validate` checks the schema in PGlite; `EQUITYRELAY_TEST_DATABASE_URL=<isolated PostgreSQL URL> npx vitest run src/lib/db/real-postgres.test.ts` exercises real PostgreSQL restart/replay/concurrency behavior. Do not point that test at a production database.
- In production, set `EQUITYRELAY_TRUSTED_CLIENT_IP_HEADER` to a header set and overwritten by the trusted edge proxy (`x-real-ip`, `cf-connecting-ip`, `x-vercel-forwarded-for`, or `x-forwarded-for`) and `EQUITYRELAY_RATE_LIMIT_SECRET` to a stable random server-only value of at least 32 characters. The challenge route fails closed if these are missing. Configure the proxy to strip incoming client copies of that header. IPs are stored only as keyed HMAC bucket identifiers. Wallet and global limits also apply.
- The read-only BSC RPC must support chain ID 56, transaction and receipt lookup, block lookup, finalized tag if required by policy, and bounded ERC-20 logs. `BSC_MIN_CONFIRMATIONS` is a configurable EquityRelay policy. The default public BSC endpoint rejected even a one-block log query during Phase 3C; a second public endpoint accepted recent bounded queries but required a token for older archive reads. Select a provider with the needed retention and rate limits before release.
- A lost transaction hash can only become a recovery candidate after a bounded scan finds exactly one transaction matching the reserved action semantics. Zero matches remain unresolved; multiple matches require manual review. A browser rejection claim alone cannot release a route. Reservation expiry additionally requires a no-match scan and a new route version/action/token.
- Venus supply verification is **READY**. A historical confirmed mainnet supply at block `124836339` validates the direct `mint(uint256)` path against the canonical receipt, exact NVDAB and vNVDAB transfers, the four-field Venus `Mint` event, and block-specific account position reads. The [Venus verifier validation page](/proof/venus-verifier) clearly labels this as historical protocol activity, not an EquityRelay execution.
- Mainnet test spending is capped at **$2 total**. Binance returned `40375: Minimum order amount is 5 USD` through the tested 0.021 NVDAon size; the first viable tested route at 0.022 NVDAon still exceeds the budget. Funded execution is not a release requirement unless a legitimate route within the cap is later found without bypassing platform rules. See [TEST_SETUP.md](docs/TEST_SETUP.md).
- A later ascending read-only probe established 0.022 NVDAon as the first viable tested route after 0.021 returned `40375`. The [dated exit preflight](docs/EXIT_PROOF_2026-09-30.md) validates a simulated Venus redeem and indicative NVDAB → USDT quote. It is not execution evidence and remains above the $2 funding cap.

## Architecture

- `src/domain/` contains pure decimal-safe exposure, identity, route, and policy decisions.
- `src/lib/binance/` signs requests and validates live RWA, Trading, and DeFi Data responses server-side.
- `src/app/api/route/preview/` accepts only human-readable user intent and returns a safe read-only result.
- `src/app/api/route/preflight/` accepts the same intent, reacquires live evidence, and returns validated unsigned actions and simulation results. Leg 2 and Venus remain indicative until leg 1 settles and the route is quoted again.
- `src/domain/authorization/` ABI-decodes approvals and constructs exact unsigned ERC-20 approvals. `src/domain/execution/` holds the staged state machine. `src/lib/execution/` holds server-only durable reviews, canonical reads and a submission adapter blocked by `PHASE3A_BROADCAST_DISABLED`. `/api/route/execute` always refuses while the code lock remains.
- `src/components/` and `src/app/` present the landing page, destination-first route flow, and feasibility record.

See [DEVEX_LOG.md](DEVEX_LOG.md) for observed API findings. The product scope and later execution safeguards are in [docs/context/BUILD_SPEC.md](docs/context/BUILD_SPEC.md).
