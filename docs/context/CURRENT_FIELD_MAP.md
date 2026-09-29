# BNB Hack: Tokenized Stocks Edition — Current Field Map

Research snapshot: 2026-09-28.

## Hackathon constraints that control idea selection

- One main track: Tokenized Stocks Products & Agents.
- bStocks, Ondo Stocks, or xStocks must be central.
- BSC mainnet only for the real tokenized-stock flow.
- Spot only; perps are outside the competition scope.
- Technical implementation: 30%.
- Creativity/originality: 25%.
- Developer Experience Report: 25%.
- Product quality/UX: 20%.
- Agentic Wallet and BNB Agent Studio are optional but each has a $2,000 special prize.

## Public/current BNB submissions discovered

### EquityMux — tang-vu/equitymux
Job: choose the best issuer representation for a requested economic exposure.
Core: normalize bStocks/Ondo/xStocks, policy-check candidates, produce replayable decision receipts.
Crowds: cross-issuer selection, execution routing, deterministic guards, MCP.
Do not rebuild: “buy NVDA and automatically pick NVDAB/NVDAon/NVDAx.”

### OneTicker — JemIIahh/oneticker
Job: safest fill for one ticker across issuer rails, especially outside market hours.
Core: cross-issuer quotes, per-share normalization, market clock, off-hours tape, deterministic GO/CAUTION/BLOCK gate.
Crowds: off-hours pricing, routing, reference-price monitoring, execution safety.
Do not rebuild: generic closing-bell agent or best-fill router.

### AlphaRadar — srbisnes/alpharadar
Job: discover tokenized-stock trading opportunities.
Core: alpha score, premium gap, charts, heat map, assistant.
Crowds: discovery dashboards, signals, visual market scanners.
Do not rebuild: “Bloomberg-lite + AI chat.”

### Steward — zkasuran/steward-bnb
Job: manage the life of a bStock after acquisition.
Core: authenticity, position ledger, baskets, pre-trade guard, Venus borrowing, cross-provider comparison, MCP/Wallet Skill/Agent Studio surfaces.
Crowds: ownership dashboard, bStock ledger, authenticity, basic collateral usage.
Do not rebuild: simple post-purchase holdings dashboard or stock-backed borrow button.

### Roost — neromtoobad/roost
Job: autonomous investing expressed through a collectible pet.
Core: deterministic trading personality, session-aware UX, Agentic Wallet, simulation, persistent worker, Agent Studio seller.
Crowds: gamified autonomous investing and “agent that buys on a rule.”
Useful UX lesson: the market state is embodied in the UI, not buried in a table.

### YoStocks — yostocks-protocol/yostocks
Job: Telegram tokenized-stock agent with strategies and guarded execution.
Core: quote/buy/sell, rules, scheduled execution, Agentic Wallet, x402 data purchases, Agent Studio seller.
Crowds: Telegram bots, natural-language rules, autopilot, paid agent data.
Do not rebuild: chat-based stock agent with DCA/targets.

### Portir — yeheskieltame/portir
Job: consumer tokenized-stock account + plans + DeFi loan protection.
Core: stocks catalog, baskets, DCA plans, guarded purchases, Agent Studio executor, Venus LoanGuard.
Crowds: consumer brokerage UX, DCA, basket buying, stock-backed loan rescue.
Do not rebuild: mutual-fund-like tokenized stock app or single-protocol liquidation guard.

### NightDesk — PhiBao/nightdesk
Job: safe buying when traditional markets are closed.
Core: session-aware truth card, spread display, executability probes, limit/alert/guarded fill, proof ledger, Agent Studio seller.
Crowds: after-hours warnings, price/reference spread UX, pool executability.
Do not rebuild: “weekend premium warning” as the whole product.

### Pronous — wadezigh96/pronous
Job: market desk and guarded agent utility.
Core: watch → compare → explain → guard → prepare → confirm → prove.
Crowds: market scanners, guardrails, simulation, proof-of-action receipts.

### Phoveus — wadezigh96/Phoveus
Job: market-clock intelligence.
Core: market-open/closed state, reference age, divergence, guarded agent decisions.
Crowds: market-clock agent and reference-age warnings.

### Orchard — phllp-tanstic/orchard
Job: consumer tokenized-stock account where the system chooses the rail.
Status at research snapshot: bootstrap.
Potential overlap: abstraction of issuer selection from consumers.

## Saturated idea zones

1. Cross-issuer “best token” routing.
2. Reference-price / onchain spread monitors.
3. Closing-bell or weekend trading warnings.
4. Generic natural-language stock trading agents.
5. DCA and basic portfolio rebalancing.
6. One-tap thematic baskets.
7. Generic MCP wrappers.
8. Tokenized-stock discovery dashboards.
9. Basic Telegram trading bots.
10. Single-protocol stock-backed loan guards.
11. Simple holdings/cost-basis dashboards.

## Less crowded jobs observed

- Portfolio-wide exitability: how much of the current portfolio can actually become stablecoin now, at a bounded cost, including DeFi positions.
- Persistent issuer-rail management after purchase: keep the same economic exposure on the most suitable representation over time rather than choosing only at entry.
- Corporate-action-aware operational safety across wallet + DeFi positions.
- Multi-protocol collateral routing/migration between lending venues, rather than a single Venus guard.
- Machine-checkable “liquidity SLA” for agents: can this position be unwound under an explicit cost/time constraint?

## Important live-market findings from public competitors

These are competitor-reported observations, not independently re-run in this research environment:

- Some teams report weak/no xStocks BSC execution liquidity for tested names.
- Ondo and bStocks can have different execution behavior and market-hour constraints.
- Binance token/reference fields require careful normalization; some public teams found that a displayed reference is not always an independent tradable price.
- A valid quote does not prove the resulting transaction will settle; simulation matters.
- Liquidity and executability differ. A pool can price an order and still fail delivery.

Treat each as a hypothesis to reproduce with our own API key and wallet before making it a product claim.
