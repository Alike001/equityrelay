# Hackathon Winner / Strong Builder DNA

This file extracts reusable product and judging patterns, not product ideas to copy.

## xStocks Hackathon, EthCC Cannes, 2026

Official results reported by xStocks/Kraken:
- 1st: xPrime — onchain prime brokerage for tokenized equities.
- 2nd: Stretch by Spreads — loops STRCx dividend yield.
- 3rd: xStream/STREAM — separates dividend rights from price exposure.
- Discretionary awards included Paragon, Aura, and Otomato/RWAct-related work.

### What the podium teaches

1. Winners changed what the asset could do, rather than merely visualizing it.
2. The value proposition fit one sentence.
3. Tokenized equities were load-bearing, not a theme pasted onto a generic app.
4. The best projects turned an existing financial workflow into a simpler onchain primitive.
5. Strong projects showed working flows, not only dashboards or research.

### Areas already validated by prior winners

- Prime brokerage / all-in-one earn-borrow-trade-spend.
- Dividend/yield looping.
- Splitting yield and price exposure.
- Liquidation-free leverage.
- Portfolio-aware alerts and smart-account reaction.

These are useful precedents but weak candidates to reproduce directly for BNB.

## winsznx — transferable patterns

Repositories examined include Lictor, NeuroDegen, Pact, Custos, BlindMarkets and others.

Patterns:
- One sharp product sentence before architecture.
- A user mandate is compiled into constrained machine-readable rules.
- AI proposes or interprets; deterministic code owns spending limits, selectors, amounts and slippage.
- Proof surfaces are first-class: receipts, status pages, journal pages, transaction links.
- Mainnet or realistic end-to-end proof is emphasized.
- Refusal is treated as a successful product outcome when conditions are unsafe.
- Architecture follows the sponsor primitive instead of adding it as an integration checkbox.

UX patterns worth borrowing:
- Public read-only/judge mode.
- A live status surface.
- One action → one visible state transition → one verifiable receipt.
- Explicit labels for live, paper, recorded and unavailable states.

## mystiquemide — transferable patterns

Repositories/products examined include SealRail, NimQuest, BlackBoxOps, Qeltrun and others.

Patterns:
- The demo proves the core invariant quickly. SealRail lets a judge deliberately run a failing proof and watch payment stay locked.
- NimQuest uses a short guided journey rather than a feature-heavy dashboard.
- Proof and completion are visible to the user, often with a receipt or leaderboard.
- “No proof, no payment” style invariants are stronger than generic feature lists.

UX patterns worth borrowing:
- Give judges a 30–90 second path that proves the main claim.
- Provide a failure path on purpose, not only a happy path.
- Make completion tangible with a receipt/status/verification link.

## Enoch208 — transferable patterns

Repositories examined include Logos and Crux.

Patterns:
- Crux focuses on a measurable failure, performs a repair, and provides a replayable evidence bundle.
- Logos creates a market structure, not another monolithic AI agent: specialists sell typed cognition and another agent procures it.
- Clear economic loop: request → payment → work → attestation → reputation.
- Claims are accompanied by evidence or measurable outputs.

UX patterns worth borrowing:
- Before/after comparison.
- Same-input replay to prove the improvement.
- Visible economic flow and per-step status.
- Independent verification path.

## mrnetwork0001 — transferable patterns

Repositories examined include ShieldSuite, Curia, Deltr, StonMaster, Nexa and others.

Patterns:
- Deep sponsor-stack integration.
- Strong visual dashboard presentation and live execution logs.
- Real transactions and deployed addresses are surfaced prominently.
- Components often expose REST/MCP/agent interfaces in addition to the web UI.
- Deterministic risk gates around automated money movement appear repeatedly.

Positive lesson:
- Make the sponsor technology necessary to the architecture.

Caution:
- Avoid scope sprawl. Several repos are broad suites. For this BNB hack, a narrower product with one undeniable loop is safer than four loosely connected modules.

## Blockchain-Oracle — transferable patterns

Repositories examined include DeFi Research Agent, KeeperHub research, Phoenix Audit, ChainPilot and others.

Patterns:
- Agent and MCP/tool layer are separated cleanly.
- Research handoffs use explicit decision gates and unresolved-question logs.
- Durable sessions and health endpoints improve judge/developer usability.
- Broad “AI DeFi assistant” products are easy to build but hard to differentiate.

Useful lesson:
- Keep the tool engine reusable, but give the product a narrow domain job.

## Composite winner pattern for our BNB project

A strong submission should look like:

1. One painful tokenized-stock job.
2. One sentence explaining it.
3. A 30-second judge loop.
4. A deterministic financial safety boundary.
5. A visible failure/refusal state.
6. A real BSC mainnet action with tiny capital.
7. A receipt proving what happened.
8. A public read-only mode that works without secrets.
9. An Agentic Wallet integration that changes what the product can do.
10. Agent Studio only if persistence/agent-to-agent commerce is naturally part of the job.
11. DevEx logging from day one.
