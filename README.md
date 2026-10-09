# EquityRelay

**Own the stock. We handle the rail.**

EquityRelay is a destination-driven router for supported tokenized equity assets on BNB Chain. Read-only previews currently support NVIDIA, SPCX and Tesla through the same `Ondo representation → USDT → bStock representation → Venus` primitive and user-defined exposure policy. Historical canonical BSC evidence validates the Venus supply and redemption verifier profiles for all three configured markets. Phase 2 builds and reviews unsigned transactions with exact bounded approvals. Phase 3 adds durable, authenticated execution preparation and canonical verification. Production remains disarmed through `EQUITYRELAY_MAINNET_EXECUTION=false`, and the deprecated backend relay remains permanently locked. No approval was signed and no transaction was broadcast.

## Run locally

1. Install Node.js 20.9 or newer and run `npm ci`.
2. Provision a PostgreSQL 16 or newer database. Set `DATABASE_URL` server-side and run `npm run migrate`. For a local rehearsal, a loopback-only Docker PostgreSQL instance is sufficient; PGlite is used only for isolated unit tests.
3. Create `.env.local` **in this repository** with `BINANCE_W3_API_KEY`, `BINANCE_W3_API_SECRET`, `DATABASE_URL`, `EQUITYRELAY_BSC_RPC_URL` and the exact `EQUITYRELAY_PUBLIC_ORIGIN`. Keep it local and ignored by Git. Do not copy the feasibility harness's secret file. Set `EQUITYRELAY_MAINNET_EXECUTION=false`.
4. Run `npm run dev` and open the configured origin.
5. Open `/app`, select a supported asset, enter a human-readable wrapper amount and a BSC address for quote context, set the maximum exposure reduction, then build the route. On `PASS`, select **Preflight route** to review unsigned actions. The address is used for read-only, potentially taker-specific quotes and simulations. The connected-wallet control signs only an authentication message; transaction controls remain disabled.

Without configured Binance credentials, the UI explicitly shows `UNAVAILABLE`.

## Verify

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The signed Binance client and response adapters follow the successful 2026-09-29 [feasibility result](docs/context/FEASIBILITY_RESULT_2026-09-29.md) and the read-only harness source. The [feasibility evidence page](/proof/feasibility) labels historical quote observations and does not claim execution.

The public [execution safety proof](/proof/execution-safety) records two distinct events. First, the guarded UI opened an exact USDT approval review in Binance Wallet; the wallet warned that the target was high risk and unverified, and the user cancelled. No approval transaction was signed or broadcast, and no allowance was confirmed onchain. A later investigation found that three authenticated Binance Web3 builds named LiquidMesh and returned `0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5` as target and spender, while the BSC diamond/facets lacked verified source or a published deployment-specific registry or audit. The team recorded `API_PROVENANCE_ONLY` and the operator decision `SECURITY_REFUSED_UNVERIFIED_ROUTER`. That decision is a presentation and security record; it is not currently called by the live action-delivery gate.

## Phase 3D execution preparation

The read-only production rehearsal is deployed at `https://equityrelay.vercel.app` on Vercel with an attached managed Neon PostgreSQL database. Binance-facing server functions are pinned to Vercel Singapore (`sin1`) because identical signed calls from the default US function region returned Binance business code `40304`; the Singapore deployment returned genuine live data without a fallback. The sanitized `/api/health/execution-readiness` check validates four migrations, chain 56, the configured finality policy, the false environment arm, and the active code lock.

- Apply `npm run migrate` to the intended managed PostgreSQL database during deployment. Migrations are serialized with a PostgreSQL advisory transaction lock and recorded in `schema_migrations`. `npm run migrate:validate` checks the schema in PGlite; `EQUITYRELAY_TEST_DATABASE_URL=<isolated PostgreSQL URL> npx vitest run src/lib/db/real-postgres.test.ts` exercises real PostgreSQL restart/replay/concurrency behavior. Do not point that test at a production database.
- In production, set `EQUITYRELAY_TRUSTED_CLIENT_IP_HEADER` to a header set and overwritten by the trusted edge proxy (`x-real-ip`, `cf-connecting-ip`, `x-vercel-forwarded-for`, or `x-forwarded-for`) and `EQUITYRELAY_RATE_LIMIT_SECRET` to a stable random server-only value of at least 32 characters. The challenge route fails closed if these are missing. Configure the proxy to strip incoming client copies of that header. IPs are stored only as keyed HMAC bucket identifiers. Wallet and global limits also apply.
- The read-only BSC RPC must support chain ID 56, archive transaction and receipt lookup, historical block lookup, the finalized tag, and bounded ERC-20/Venus logs. `BSC_MIN_CONFIRMATIONS` is a configurable EquityRelay policy. Production uses NodeReal's documented BSC endpoint with a three-confirmation policy plus the BSC `finalized` tag. Readiness proves those capabilities against a labeled historical Venus transaction and fails closed as `RPC_VERIFICATION_UNAVAILABLE`. Exact-address/topic reads remain paged in conservative 50-block windows. No independent fallback has qualified yet, so readiness reports `fallbackQualified: false`; a private service-level primary and independently qualified fallback remain operational prerequisites for stronger provider redundancy.
- A lost transaction hash can only become a recovery candidate after a bounded scan finds exactly one transaction matching the reserved action semantics. Zero matches remain unresolved; multiple matches require manual review. A browser rejection claim alone cannot release a route. Reservation expiry additionally requires a no-match scan and a new route version/action/token.
- Venus supply verification is **READY**. A historical confirmed mainnet supply at block `124836339` validates the direct `mint(uint256)` path against the canonical receipt, exact NVDAB and vNVDAB transfers, the four-field Venus `Mint` event, and block-specific account position reads. The [Venus verifier validation page](/proof/venus-verifier) clearly labels this as historical protocol activity, not an EquityRelay execution.
- Binance returned `40375: Minimum order amount is 5 USD` through the tested 0.021 NVDAon size. The first viable tested route was 0.022 NVDAon. The latest source-acquisition requirement is dated planning evidence; it is not a funding instruction. See [TEST_SETUP.md](docs/TEST_SETUP.md).
- A later ascending read-only probe established 0.022 NVDAon as the first viable tested route after 0.021 returned `40375`. The [dated exit preflight](docs/EXIT_PROOF_2026-09-30.md) validates a simulated Venus redeem and indicative NVDAB → USDT quote. It is not execution evidence and remains above the $2 funding cap.

## Architecture

- `src/domain/` contains pure decimal-safe exposure, identity, route, and policy decisions.
- `src/domain/equities/registry.ts` is the server-authoritative allowlist for preview identities and capability status. Live Binance RWA and DeFi data remain authoritative for availability, ratios, open state, investment identity and investability.
- `src/lib/binance/` signs requests and validates live RWA, Trading, and DeFi Data responses server-side.
- `src/app/api/route/preview/` accepts only human-readable user intent and returns a safe read-only result.
- `src/app/api/route/preflight/` accepts the same intent, reacquires live evidence, and returns validated unsigned actions and simulation results. Leg 2 and Venus remain indicative until leg 1 settles and the route is quoted again.
- `src/domain/authorization/` ABI-decodes approvals and constructs exact unsigned ERC-20 approvals. `src/domain/execution/` holds the staged product, test-setup, redemption, exit, recovery state machines, and the separate router-provenance security decision. `src/lib/execution/` holds server-only durable reviews and canonical reads. Connected-wallet delivery is guarded by the server environment arm. `/api/route/execute` is a deprecated relay and always refuses through `PHASE3A_BROADCAST_DISABLED`.
- `src/components/` and `src/app/` present the landing page, destination-first route flow, and feasibility record.

Authenticated execution route creation remains server-authoritative for the configured allowlist. NVDA, SPCX and TSLA now have distinct Venus verification profiles backed by genuine historical supply and redemption receipts. Current live RWA and Venus identities must agree with the profile before preparation, and the global execution guards remain active for every asset.

See [DEVEX_LOG.md](DEVEX_LOG.md) for observed API findings. The product scope and later execution safeguards are in [docs/context/BUILD_SPEC.md](docs/context/BUILD_SPEC.md).

Start with the public [judge demo](/demo), then use [system status](/status), the [submission demo script](docs/SUBMISSION_DEMO.md), and [judge Q&A](docs/JUDGE_QA.md).
