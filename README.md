# EquityRelay

**Own the stock. We handle the rail.**

EquityRelay is a read-only destination router for NVIDIA tokenized stock on BNB Chain. Phase 1 compiles `NVDAon → USDT → NVDAB → Venus`, compares NVIDIA-equivalent shares with a user-defined exposure-loss limit, and shows `PASS`, `BLOCKED`, or `UNAVAILABLE` in the product UI. Phase 2A can refresh a passing route, build unsigned Binance swap and Venus actions, and request read-only simulations. It does not sign, approve, swap, broadcast, or deposit.

## Run locally

1. Install Node.js 20.9 or newer and run `npm ci`.
2. Create `.env.local` **in this repository** with `BINANCE_W3_API_KEY` and `BINANCE_W3_API_SECRET`. Keep the file local; it is ignored by Git. Do not copy the feasibility harness's secret file.
3. Run `npm run dev` and open `http://localhost:3000`.
4. Open `/app`, enter a human-readable NVDAon amount and a BSC address for quote context, set the maximum exposure reduction, then build the route. On `PASS`, select **Preflight route** to refresh the evidence and review unsigned actions. The address is used only for read-only, potentially taker-specific Binance quotes and simulations. No private key is required. A wallet with no relevant token balance can still receive a quote and build plan, while simulation can report insufficient balance or allowance.

Without configured Binance credentials, the UI explicitly shows `UNAVAILABLE`.

## Verify

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The signed Binance client and response adapters follow the successful 2026-09-29 [feasibility result](docs/context/FEASIBILITY_RESULT_2026-09-29.md) and the read-only harness source. The [feasibility evidence page](/proof/feasibility) labels historical quote observations and does not claim execution.

## Architecture

- `src/domain/` contains pure decimal-safe exposure, identity, route, and policy decisions.
- `src/lib/binance/` signs requests and validates live RWA, Trading, and DeFi Data responses server-side.
- `src/app/api/route/preview/` accepts only human-readable user intent and returns a safe read-only result.
- `src/app/api/route/preflight/` accepts the same intent, reacquires live evidence, and returns validated unsigned actions and simulation results. Leg 2 and Venus remain indicative until leg 1 settles and the route is quoted again.
- `src/components/` and `src/app/` present the landing page, destination-first route flow, and feasibility record.

See [DEVEX_LOG.md](DEVEX_LOG.md) for observed API findings. The product scope and later execution safeguards are in [docs/context/BUILD_SPEC.md](docs/context/BUILD_SPEC.md).
