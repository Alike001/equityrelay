# EquityRelay UX Specification

## UX principle

The application is not a DEX. The user's primary mental model is:

> "I own a stock. I want to use it somewhere."

The app owns the representation/rail complexity.

## Landing page

### Navigation

Left: EquityRelay wordmark.

Right:
- How it works
- Safety
- Proof
- GitHub
- `Open app` primary CTA

Keep navigation compact. No giant ecosystem mega-menu.

### Hero

Eyebrow:

`TOKENIZED STOCK ROUTING · BNB CHAIN`

Headline:

**Own the stock. We handle the rail.**

Subheadline:

> Use the tokenized stock you already hold in the BNB app you actually want. EquityRelay finds the compatible representation, preserves your underlying exposure inside your limit, preflights each action, and shows exactly what happened.

Primary CTA: `Route my stock`

Secondary CTA: `See a verified route`

Hero visual: an interactive route card, not a stock-price chart.

```text
NVIDIA
Current: NVDAon · Ondo

Goal
Use as collateral on Venus

Compiled route
NVDAon -> USDT -> NVDAB -> Venus

Exposure retained
99.93%

Policy
Minimum 99.50%  PASS
```

For the landing demo, numbers must be labeled as a recorded feasibility example unless they are live.

### Section 2 — The problem

Heading:

**Same stock. Different rails.**

Three compact cards show the same underlying with different representations:

```text
NVIDIA
NVDAon · Ondo
NVDAB  · bStocks
NVDAx  · xStocks
```

Then show destination compatibility:

```text
Venus -> NVDAB supported
NVDAon -> not the destination asset
```

Copy should explain that users should not need to learn issuer plumbing to use their stock.

### Section 3 — How it works

Use four large steps, horizontally on desktop and vertically on mobile:

1. **Choose a destination**
   "Use NVIDIA on Venus."

2. **Compile a valid rail**
   EquityRelay resolves issuer rules, ratios, quotes, and required representation.

3. **Preflight the exact plan**
   Exposure-retention policy, asset status, quote freshness, destination status, transaction preview.

4. **Execute and verify**
   Each step is confirmed before the next begins; completed routes end in a receipt.

### Section 4 — Safety invariant

Heading:

**Unsafe is a valid answer.**

Side-by-side cards:

PASS example:

```text
Expected retention 99.93%
Your minimum       99.50%
VENUS              INVESTABLE
Result             READY
```

BLOCK example:

```text
Expected retention 98.71%
Your minimum       99.50%
Result             BLOCKED
No transaction prepared
```

This is a core differentiator and judge-demo moment.

### Section 5 — Live / recorded proof

Borrow the proof-surface lesson from NeuroDegen without copying its UI.

Show one completed route card with:
- underlying;
- source representation;
- settlement path;
- target representation;
- destination;
- before/after normalized exposure;
- policy verdict;
- transaction statuses;
- BscScan links when available;
- `View receipt` and `Technical proof`.

Before mainnet execution exists, mark it `FEASIBILITY RECORD`, not `LIVE PROOF`.

### Section 6 — Built for BNB

Do not make this only a sponsor-logo strip. Show each sponsor primitive with its job:

```text
Binance RWA Data     identify + normalize representations
Trading API          executable route quotes
Transaction API      preflight exact EVM actions
Wallet API           portfolio/balance state
DeFi Data            destination discovery
DeFi Transaction     Venus deposit preview/build
Agentic Wallet       bounded user-authorized execution (phase after manual proof)
BNB Agent Studio     persistent mandates only after V1 is proven
```

### Footer

- GitHub
- Demo
- DevEx report
- BNB Chain
- Hackathon note
- clear informational/not-investment-advice disclaimer

## App shell

Desktop: narrow left rail or top navigation, not both.

Recommended top-level views:

```text
Route
Activity
Proof
Settings
```

Wallet connect/status stays top-right.

## `/app` — destination-first start

Primary card:

```text
What do you want to do with your stock?

Your eligible holdings
NVIDIA · NVDAon · $...

Destination
[ Venus — use as collateral ]

Maximum exposure reduction
[ 0.50% ]

[ Build route ]
```

Do not lead with a token picker.

## Route review

The route should read like a compiled plan:

```text
NVIDIA -> Venus

1  Current rail
   NVDAon · Ondo

2  Settlement
   NVDAon -> USDT

3  Destination rail
   USDT -> NVDAB

4  Destination
   Supply NVDAB to Venus
```

Beside it, show the invariant card:

```text
BEFORE
normalized NVDA exposure ...

PROJECTED AFTER CONVERSION
...

RETENTION
99.xx%

YOUR MINIMUM
99.50%

PASS
```

Advanced disclosure accordion:
- full contract addresses;
- token-to-share ratios;
- quote IDs/vendor;
- expiry/freshness;
- price impact;
- estimated fees;
- destination investmentId;
- raw API warnings.

## Execution screen

Never use one deceptive "Executing..." spinner for a multi-stage financial route.

Use explicit state machine rows:

```text
1 Sell NVDAon for USDT       READY / SUBMITTED / CONFIRMED / FAILED
2 Re-check policy            WAITING / PASS / BLOCKED
3 Buy NVDAB                  WAITING / SUBMITTED / CONFIRMED / FAILED
4 Preview Venus deposit      WAITING / PASS / BLOCKED
5 Deposit NVDAB              WAITING / SUBMITTED / CONFIRMED / FAILED
6 Verify resulting position  WAITING / VERIFIED / SYNCING
```

If leg 1 completes but leg 2 fails policy:

```text
PARTIAL ROUTE STOPPED

Your NVDAon sale completed.
The NVDAB re-entry no longer meets your 0.50% limit.
Funds remain in USDT.
Nothing else was submitted.
```

This state must be treated as a designed outcome, not an exception modal.

## Receipt

Human-readable `/receipt/[id]`:

```text
EquityRelay Receipt

Goal                 Use NVIDIA on Venus
Source               NVDAon / Ondo
Target               NVDAB / bStocks
Settlement           USDT
Destination          Venus
Policy               max 0.50% exposure reduction
Projected retention  ...
Actual retention     ...
Result                VERIFIED / BLOCKED / PARTIAL
```

Then list every transaction separately with submitted/confirmed/final status.

## Proof page

Technical `/proof/[id]` for judges:

- route input hash / receipt ID;
- exact token contracts;
- ratios used and timestamps;
- quote snapshots and timestamps;
- user policy;
- policy decision;
- tx hashes;
- actual received amounts;
- Venus investmentId;
- resulting position evidence;
- independent BscScan links.

No database-only claim should be labeled independently verified.

## Mobile

The route timeline collapses vertically. Sticky bottom CTA only when a user decision is required. Never hide PASS/BLOCKED and projected exposure below an accordion.

## Accessibility / polish

- Full keyboard navigation.
- High contrast status labels plus text/icons; do not rely on color alone.
- Skeleton loading for API reads, never layout jumps.
- Numeric columns use tabular figures.
- Token addresses copyable.
- Every external transaction link opens in a new tab.
- No confetti for financial execution.
- Motion only for route compilation/progress and should respect reduced-motion preferences.
