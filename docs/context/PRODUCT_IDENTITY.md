# EquityRelay — Product Identity

Status: working identity for BNB Hack: Tokenized Stocks Edition
Date locked: 2026-09-29

## Name

**EquityRelay**

Working only; perform final domain/trademark/social-handle checks before public launch.

## Tagline

**Own the stock. We handle the rail.**

## One-sentence pitch

EquityRelay lets a user choose what they want to do with a tokenized stock on BNB Chain, then converts the representation they already hold into the representation the destination accepts, within a user-defined exposure-loss limit, with preflight checks and a verifiable receipt.

## Judge version

> I already own NVIDIA as NVDAon, but Venus accepts NVDAB. EquityRelay preserves my NVIDIA exposure while routing through the valid issuer path, preflights every step, and makes the resulting NVDAB usable on Venus.

## What EquityRelay is

- A destination router for tokenized equities.
- An abstraction layer over issuer-specific stock representations.
- A deterministic route compiler with explicit financial safety policies.
- A guided consumer flow that hides token plumbing by default.
- A receipt/proof surface for every completed or blocked route.

## What EquityRelay is not

- Not another portfolio tracker.
- Not a generic AI trading agent.
- Not a "best issuer" stock-buy router.
- Not an arbitrage bot.
- Not a P2P wrapper marketplace in V1.
- Not a lending protocol.
- Not DrawRail on another chain.

## Core product invariant

The user chooses an underlying stock and a destination. EquityRelay may change the issuer representation, but it must not silently change the underlying economic intent.

For V1:

```text
underlying = NVDA
source = NVDAon
valid settlement bridge = USDT
target = NVDAB
destination = Venus
```

The route must be rejected if projected normalized NVIDIA exposure after conversion falls outside the user's policy.

## Canonical V1 user story

> "I already hold NVIDIA onchain. I want to use it on Venus without having to understand which NVIDIA wrapper Venus accepts."

EquityRelay resolves:

```text
NVDAon
  ↓
USDT
  ↓
NVDAB
  ↓
Venus
```

and explains the route as:

```text
Your asset: NVIDIA
Your current rail: Ondo
Destination: Venus
Required rail: bStocks
Expected exposure retained: X%
Policy: minimum Y%
Result: PASS / BLOCKED
```

## Product vocabulary

Prefer:
- stock
- underlying
- representation
- rail
- destination
- exposure retained
- route
- preflight
- receipt
- blocked

Avoid in primary UX:
- wrapper
- BEP-20
- spender
- allowance
- calldata
- router
- slippage BPS
- token-to-share multiplier

Those belong under "Technical details" / "Why this route?".

## Tone

- Financially calm, not casino-like.
- Precise and explicit about uncertainty.
- A refusal is a successful safety outcome.
- Never imply a route is complete because it was only submitted.
- Never call an estimate a guaranteed result.

## Design direction

Avoid the common Web3 visual language of dark purple gradients, floating coins, generic glowing grids, and AI chat bubbles.

Use a product-finance visual language:
- light/neutral canvas by default;
- strong typography;
- compact cards;
- one accent color for active route state;
- green only for verified success;
- amber for review/warnings;
- red only for blocked/failed states;
- issuer colors/logos secondary, never the hierarchy driver;
- route diagrams should look like infrastructure being compiled, not a DEX swap widget.

## UX inspiration distilled from prior-project research

Borrow patterns, not appearance or copy:

- Portir: lead with the financial job instead of token mechanics; consumer-first language.
- NeuroDegen: expose Live / Journal / Proof as first-class judge surfaces.
- Lictor-style products: compile natural user intent into deterministic constraints.
- SealRail: deliberately demo a failure path and prove that unsafe execution stays blocked.
- Crux: make before/after evidence independently understandable.
- ShieldSuite: show sponsor integration through real product plumbing, not logo rows alone.

## Public routes

Recommended V1 information architecture:

```text
/                 Landing page
/app              Guided destination router
/activity         Route journal / past attempts
/receipt/[id]     Human-readable route receipt
/proof/[id]       Technical verification / judge view
/devex            Optional public DevEx highlights near submission
```

`/receipt` explains the result to a normal user. `/proof` exposes the technical evidence to judges/developers.
