# EquityRelay submission demo

## One-minute safety narrative

1. Open `/app` and select a supported asset. Explain that live Binance RWA, Trading and DeFi data determine current availability; dated values never substitute for a live result.
2. Show a read-only route preview. Point out representation identity, exact settlement legs, normalized underlying exposure, the user’s loss limit, and the separate verifier capability label.
3. Open `/proof/venus-verifier`. Explain that the transaction is labeled historical protocol activity. It validates canonical event and position verification and is not presented as an EquityRelay execution.
4. Open `/proof/execution-safety`. Explain that an exact approval review reached Binance Wallet, the wallet warned about the unverified target, and the user cancelled. Nothing was signed or broadcast and no allowance was confirmed. Then show the two evidence columns:
   - **Authenticated API provenance:** three signed Binance builds named LiquidMesh and returned the same target/spender.
   - **Deployed contract provenance:** BSC source and active ERC-2535 facets were unverified, and no published deployment registry or matching audit was found.
5. Walk through the truthful sequence: Binance quote → exact approval review → wallet warning → user cancellation → later provenance investigation → recorded operator refusal.
6. Click **Recheck router on BNB Chain**. Explain that a hash match proves only that current runtime bytes match the recorded bytes.
7. End on `SECURITY_REFUSED_UNVERIFIED_ROUTER`. State that it is a recorded operator decision, not an automatic action-delivery gate, and production remains disarmed.

## Capability statement

| Capability | Submission status |
|---|---|
| Live multi-equity preview | Available when current Binance liquidity and services pass |
| Exposure policy | Deterministic and wrapper-ratio normalized |
| Venus supply/redeem verification | Validated with labeled historical canonical evidence |
| Durable authenticated execution architecture | Implemented and globally disarmed |
| Current LiquidMesh router authorization | Recorded operator refusal: API provenance only |
| Mainnet EquityRelay execution | Not performed |

## Claims to avoid

- Do not call historical Venus fixtures EquityRelay transactions.
- Do not say Binance or LiquidMesh owns the router address.
- Do not say an exact approval makes unverified code safe or that the provenance decision is runtime-enforced.
- Do not imply live execution occurred.
