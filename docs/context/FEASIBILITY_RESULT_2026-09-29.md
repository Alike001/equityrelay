# Feasibility Result — NVDA Destination Route

Collected: 2026-09-29

Sensitive wallet identifiers intentionally omitted from this context file.

## Result

**PASS WITH LIMITATIONS.**

The original direct-wrapper mechanism does not work through the Binance Trading API, but the destination-routing product survives using the issuer-compliant USDT settlement path.

## Live RWA normalization

| wrapper | platform | decimals | token-to-share ratio | observed token price |
|---|---|---:|---:|---:|
| NVDAon | ondo | 18 | 1.0017152487959898 | 231.959694514850393198797808547546 |
| NVDAB | bstock | 18 | 1.000778223752807865 | 231.4800031540244591745 |

Implication: raw token quantities cannot be treated as equivalent. Route policy must reason about normalized underlying-share exposure.

## Route evidence

Direct `NVDAon -> NVDAB` failed at all tested sizes with Binance business error `40368`:

> Ondo asset on chain 56 can only pair with allowed stablecoin(s).

Explicit `NVDAon -> USDT -> NVDAB` fallback succeeded at all tested sizes:

| source size | exposure retained | exposure reduction | reported fallback fees |
|---:|---:|---:|---:|
| ~$10 | 99.9583% | 0.0417% | $0.0412 |
| ~$100 | 99.9264% | 0.0736% | $0.0389 |
| ~$500 | 99.9156% | 0.0844% | $0.0371 |

These are quote-time observations, not guaranteed execution outcomes.

## Destination evidence

Binance DeFi catalogue returned:

- Protocol: Venus
- Asset: NVDAB
- `investable=true`
- investmentId: `1c520367b6779442806f2efe6da12afd27c747e49b0d3296ac8bdb7e87104eb8`

This means the sponsor stack itself recognizes the target NVDAB -> Venus destination.

## Architecture consequence

Do not model "direct wrapper swap with stablecoin fallback".

Model issuer constraints explicitly:

```text
Ondo stock representation
        ↓
allowed settlement asset
        ↓
USDT
        ↓
bStock representation
        ↓
destination
```

For the canonical route:

```text
NVDAon -> USDT -> NVDAB -> Venus
```

## Important execution limitation

The two stock-conversion legs are sequential unless a later mechanism proves atomic composition. Quote-time feasibility does not guarantee both legs remain inside policy at execution time.

Required V1 behavior:

1. Quote both legs and compute projected normalized retention.
2. Reject if policy fails before execution.
3. Execute/confirm leg 1.
4. Re-quote leg 2 against the actual USDT received.
5. Re-run the policy.
6. If leg 2 is now outside policy, STOP in USDT and clearly report `PARTIAL_ROUTE_STOPPED`; never force the second leg.
7. Only after NVDAB is confirmed should the Venus deposit be prepared.

This failure mode must be shown in the product and tested.

## DevEx finding to preserve

Expected behavior: aggregator might internally route NVDAon to NVDAB through a stable asset.

Observed: direct pair rejected with HTTP 200/business code 40368 before routing.

Workaround: model issuer-specific settlement constraints and create two bounded legs through USDT.

Suggested platform improvement: expose allowed settlement assets per RWA issuer/token in RWA metadata so applications can compile valid route graphs before hitting the trading error.
