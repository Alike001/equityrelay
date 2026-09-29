# EquityRelay — Competition Build Specification

Hackathon: BNB Hack: Tokenized Stocks Edition
Status: V1 scope locked after live feasibility
Date: 2026-09-29

## 0. Product sentence

**EquityRelay lets a user choose what they want to do with a tokenized stock on BNB Chain, then compiles the valid issuer rail required by the destination, preserves normalized underlying exposure inside the user's policy, preflights every action, and produces a verifiable receipt.**

Canonical V1:

```text
NVDAon -> USDT -> NVDAB -> Venus
```

User mental model:

```text
I own NVIDIA -> I want to use it on Venus
```

not:

```text
I want to swap Ondo BEP-20 X for bStock BEP-20 Y
```

---

## 1. Why this exists

Tokenized stocks on BSC can represent the same underlying company through different issuers. Those representations have different settlement constraints and downstream integrations.

A user may already own one representation while a destination supports another. The user should not need to understand issuer suffixes, share multipliers, stable settlement constraints, route vendors, approvals, or DeFi investment IDs just to use the same underlying stock in a BNB application.

Live feasibility established the concrete NVDA problem:

- NVDAon and NVDAB both exist on BSC.
- Their token-to-share ratios differ.
- Binance Trading rejects direct `NVDAon -> NVDAB` with business code `40368` because Ondo assets can only pair with allowed stablecoins.
- Explicit `NVDAon -> USDT -> NVDAB` quoted successfully at approximately $10, $100 and $500.
- Quote-time normalized exposure retention was 99.9583%, 99.9264% and 99.9156% respectively.
- Binance DeFi catalogue returns an investable NVDAB Venus investment.

Therefore the product is not a best-price issuer router. It is a destination-aware route compiler.

---

## 2. Competition alignment

Tokenized stocks are load-bearing: removing NVDAon/NVDAB removes the product.

Required sponsor/API roles:

| Primitive | V1 job |
|---|---|
| Binance RWA Data | discover representations, underlying, status, token-to-share ratio |
| Binance Trading API | quote executable NVDAon/USDT and USDT/NVDAB legs |
| Binance Transaction API | simulate exact EVM transactions when usable |
| Binance Wallet API | wallet balances / position input |
| Binance DeFi Data | resolve NVDAB Venus `investmentId` and investable status |
| Binance DeFi Transaction | build + simulate Venus NVDAB deposit |
| BSC mainnet | real tokenized-stock execution and final proof |
| Agentic Wallet | phase after manual route works; scoped execution and wallet-side limits |
| BNB Agent Studio | optional persistent mandate after V1; do not block submission on it |

Do not add B402/x402 merely for a sponsor checkbox.

---

## 3. V1 scope

### Supported underlying

- NVDA only.

### Supported source

- NVDAon / Ondo on BSC.

### Settlement asset

- USDT on BSC.

### Destination representation

- NVDAB / bStocks.

### Destination

- Venus NVDAB supply/collateral market.

### User policy

- Maximum normalized exposure reduction.
- Default UI value: 0.50%.
- User may tighten it; do not silently loosen it.

### V1 route

```text
NVDAon
  ↓ leg 1
USDT
  ↓ leg 2
NVDAB
  ↓ destination action
Venus
```

### Explicit non-goals

- xStocks.
- generic stock catalogue.
- DCA.
- thematic baskets.
- portfolio recommendations.
- borrowing after deposit.
- lending venue optimization.
- cross-chain bridge.
- P2P matching.
- custom AMM.
- custom token.
- autonomous trading.
- corporate-action automation.
- more than one underlying before the full NVDA loop is mainnet-proven.

---

## 4. Core invariant and math

### Normalized exposure

Never compare raw wrapper units.

Conceptually:

```text
underlyingShares = tokenAmount * tokenToShareRatio
```

Use decimal-safe arithmetic. No JS binary floating point for policy decisions.

For source and target, preserve the ratio snapshot and timestamp in the receipt.

### Exposure retention

```text
retention = projectedTargetUnderlyingShares / sourceUnderlyingShares
exposureReduction = 1 - retention
```

Policy passes only when:

```text
exposureReduction <= userMaxExposureReduction
```

Do not represent quote-time retention as guaranteed actual retention.

### Final realized retention

After both swap legs confirm, calculate realized target normalized shares from the actual NVDAB received and the ratio snapshot policy defined for final verification.

The spec must explicitly decide whether final verification uses:
- execution-time target ratio snapshot, or
- a single route-start snapshot.

Recommended V1: persist both; policy uses a route-start snapshot for consistency, while receipt shows any ratio movement separately.

---

## 5. Route compiler

The route engine is deterministic.

Input:

```ts
type RouteIntent = {
  wallet: Address;
  underlying: 'NVDA';
  sourceToken: Address; // NVDAon
  destination: 'venus-nvdab';
  sourceAmount: DecimalString;
  maxExposureReductionBps: number;
};
```

Output:

```ts
type RoutePlan = {
  underlying: 'NVDA';
  source: RepresentationSnapshot;
  settlement: RepresentationSnapshot; // USDT
  target: RepresentationSnapshot;     // NVDAB
  destination: DestinationSnapshot;
  leg1Quote: QuoteSnapshot;
  leg2IndicativeQuote: QuoteSnapshot;
  projectedRetentionBps: number;
  policyVerdict: 'PASS' | 'BLOCK';
  expiresAt: string;
  reasons: ReasonCode[];
};
```

Canonical reason codes:

```text
PASS_ROUTE_READY
BLOCK_SOURCE_NOT_SUPPORTED
BLOCK_SOURCE_STATUS
BLOCK_DESTINATION_UNAVAILABLE
BLOCK_DESTINATION_NOT_INVESTABLE
BLOCK_NO_LEG1_QUOTE
BLOCK_NO_LEG2_QUOTE
BLOCK_EXPOSURE_POLICY
BLOCK_QUOTE_EXPIRED
BLOCK_RATIO_INVALID
BLOCK_API_INCOMPLETE
PARTIAL_ROUTE_STOPPED
```

Never let an LLM invent/override these codes.

---

## 6. Sequential execution risk

The conversion is two sequential financial legs unless later evidence proves an atomic path.

This must be designed into the product.

### Before leg 1

- source balance sufficient;
- source status acceptable;
- destination still investable;
- both indicative quotes available;
- projected normalized retention passes policy;
- route not expired.

### After leg 1 confirms

Actual USDT received becomes the input to leg 2.

Mandatory:

1. fetch fresh NVDAB ratio/status;
2. fetch fresh USDT -> NVDAB quote using actual USDT received;
3. recompute projected final retention;
4. re-run user policy;
5. only then prepare/submit leg 2.

If policy no longer passes:

```text
status = PARTIAL_ROUTE_STOPPED
asset = USDT
```

No automatic reversal. No forced second leg. Explain what happened.

This is a deliberate safety feature and should be part of the judge demo/tests.

---

## 7. Destination flow

After NVDAB is confirmed:

1. resolve/refresh the Venus NVDAB investment through DeFi Data;
2. require `investable=true`;
3. call DeFi Transaction deposit builder with `simulate=true`;
4. render ordered actions returned by Binance, typically `APPROVE` then `DEPOSIT`;
5. display preview: fees, balance deltas, warnings, health-factor change where returned;
6. user explicitly confirms;
7. sign/broadcast in order;
8. wait for chain confirmation;
9. verify the resulting position using DeFi position read / chain evidence;
10. create receipt.

Known feasibility investmentId at 2026-09-29:

`1c520367b6779442806f2efe6da12afd27c747e49b0d3296ac8bdb7e87104eb8`

Do not hard-code it as eternal truth. Discover it at runtime by token/protocol; use the known ID only for tests/diagnostics.

Direct Venus fallback if Binance DeFi transaction support regresses:

- NVDAB: `0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436`
- vNVDAB: `0xEb8Ca841cBe1BC4832A10b15c7dAB1081eDaD371`

Fallback is only allowed if documented and tested; Binance APIs remain central to the competition build.

---

## 8. State machine

Canonical route states:

```text
DRAFT
  ↓
DISCOVERING
  ↓
ROUTE_READY
  ↓
POLICY_PASS / BLOCKED
  ↓
LEG1_READY
  ↓
LEG1_SUBMITTED
  ↓
LEG1_CONFIRMED
  ↓
LEG2_RECHECK
  ├── PARTIAL_ROUTE_STOPPED
  ↓
LEG2_READY
  ↓
LEG2_SUBMITTED
  ↓
LEG2_CONFIRMED
  ↓
DESTINATION_PREVIEW
  ├── DESTINATION_BLOCKED
  ↓
DEPOSIT_READY
  ↓
DEPOSIT_SUBMITTED
  ↓
DEPOSIT_CONFIRMED
  ↓
VERIFYING
  ↓
VERIFIED
```

A submit response is never equivalent to confirmation.

---

## 9. Application architecture

Recommended stack:

- Next.js App Router.
- TypeScript strict mode.
- React.
- Tailwind CSS.
- shadcn/ui primitives, customized rather than default-looking.
- viem for EVM types/reads where necessary.
- Zod for every external API boundary.
- decimal.js / big.js or integer rational helpers for exposure math.
- no database required for first tracer bullet; receipts can initially be local/server JSON + onchain evidence links.
- add lightweight persistence only when route journal requires it.

### Security boundary

- Binance Web3 API secret server-side only.
- Never expose API secret in browser bundle.
- No server-held user private key.
- Wallet remains the signing authority.
- Agentic Wallet integration must respect preview/confirmation and wallet-side limits.

### Suggested module boundaries

```text
src/
  app/
    page.tsx                 landing
    app/page.tsx             destination router
    activity/page.tsx
    receipt/[id]/page.tsx
    proof/[id]/page.tsx
    api/
      route/preview/route.ts
      route/refresh-leg2/route.ts
      defi/preview/route.ts
  components/
    landing/
    route/
    proof/
    shared/
  domain/
    exposure.ts
    policy.ts
    route-state.ts
    reason-codes.ts
    receipt.ts
  server/
    binance/
      client.ts
      rwa.ts
      trading.ts
      transaction.ts
      wallet.ts
      defi-data.ts
      defi-transaction.ts
    route-compiler.ts
    receipt-builder.ts
  lib/
    decimal.ts
    address.ts
    env.ts
```

Keep domain math pure and testable without network calls.

---

## 10. API evidence rules

Every external API adapter must return typed evidence, not only a convenient result.

Quote snapshot should preserve:
- request timestamp;
- quoteId;
- vendor;
- from/to contracts;
- input/output raw amounts;
- fees returned;
- price impact field with documented interpretation;
- API/business error if any;
- expiry/TTL if available.

Representation snapshot should preserve:
- platform;
- symbol;
- contract;
- decimals;
- underlying ticker;
- token-to-share ratio;
- status;
- timestamp/source.

Destination snapshot should preserve:
- protocol;
- investmentId;
- asset token contract;
- investable flag;
- timestamp.

---

## 11. Landing page requirement

The landing page is a competition deliverable, not marketing filler.

It must answer in one viewport:

1. What is the product?
2. Why does tokenized-stock representation matter?
3. What concrete destination does it unlock?
4. Can I try it / see proof?

Hero copy:

**Own the stock. We handle the rail.**

Subcopy:

> Use the tokenized stock you already hold in the BNB app you actually want. EquityRelay finds the compatible representation, keeps the conversion inside your exposure limit, preflights each action, and shows exactly what happened.

CTA:
- `Route my stock`
- `See a verified route`

Detailed layout is in `UX_SPEC.md`.

---

## 12. App UX requirement

Do not expose a DEX-style token selector as the primary experience.

Primary journey:

```text
connect wallet
  ↓
choose eligible holding (NVIDIA)
  ↓
choose destination (Venus)
  ↓
set exposure-loss limit
  ↓
build route
  ↓
review before/after exposure
  ↓
confirm each state-changing stage
  ↓
receipt / proof
```

Advanced details are collapsible but always available.

---

## 13. Judge mode

A judge must be able to understand the product without owning NVDAon.

Provide:

- public landing;
- recorded feasibility route built from real API observations, clearly labeled;
- later, one tiny mainnet executed route as the canonical proof;
- read-only receipt/proof page;
- `Try with my wallet` for eligible users;
- deterministic BLOCK example using a deliberately strict exposure threshold.

Demo should prove both:

```text
safe route -> PASS
unsafe route -> BLOCKED
```

and optionally:

```text
leg 1 succeeds, refreshed leg 2 breaks policy -> PARTIAL_ROUTE_STOPPED
```

using fixtures if deliberately inducing that state on mainnet would be wasteful.

---

## 14. Receipt model

Minimum receipt fields:

```ts
type EquityRelayReceipt = {
  id: string;
  createdAt: string;
  underlying: 'NVDA';
  goal: 'VENUS_COLLATERAL';
  sourceRepresentation: RepresentationSnapshot;
  settlementAsset: RepresentationSnapshot;
  targetRepresentation: RepresentationSnapshot;
  destination: DestinationSnapshot;
  policy: {
    maxExposureReductionBps: number;
  };
  projected: {
    normalizedSourceShares: string;
    normalizedTargetShares: string;
    retentionBps: number;
  };
  actual?: {
    normalizedTargetShares: string;
    retentionBps: number;
  };
  legs: RouteLegReceipt[];
  destinationAction?: DestinationActionReceipt;
  finalStatus:
    | 'BLOCKED'
    | 'PARTIAL_ROUTE_STOPPED'
    | 'CONVERSION_VERIFIED'
    | 'VERIFIED';
  reasons: ReasonCode[];
};
```

Hash/canonicalize receipts when feasible so judge evidence cannot be silently rewritten.

---

## 15. Testing

### Pure unit tests

- ratio normalization.
- decimals conversion.
- retention math.
- threshold equality boundary.
- invalid/zero ratio fail closed.
- quote freshness.
- deterministic reason-code ordering.
- state-transition legality.
- partial-route policy recheck.

### Fixture/integration tests

Record sanitized real API shapes for:
- NVDAon RWA row.
- NVDAB RWA row.
- direct pair 40368.
- successful NVDAon -> USDT quote.
- successful USDT -> NVDAB quote.
- Venus NVDAB investment discovery.
- Venus deposit preview.

Never record credentials or session tokens.

### Live read-only tests

- RWA discovery.
- both quote legs.
- destination discovery.
- route preview at small size.

### Mainnet proof

Only after previews/tests pass:
- fund controlled wallet with small amounts;
- execute smallest useful route;
- verify every transaction independently;
- keep proof hashes in README/submission.

---

## 16. DevEx report

Create `DEVEX_LOG.md` on repository day zero.

Every entry:

```text
Date/time
API / endpoint
What we attempted
Expected
Actual
Error code/message
Impact
Workaround
Suggested improvement
Evidence / commit
```

Seed the first entry with the direct-pair `40368` discovery from the feasibility test.

Do not reconstruct the 25% DevEx report from memory at submission time.

---

## 17. Agentic Wallet phase

Do not block manual V1 on Agentic Wallet.

After manual route works:

Use Agentic Wallet for:
- wallet-side execution;
- preview-before-action;
- scoped limits;
- transaction/order status;
- potentially easier handling of stock trading constraints.

Hard rule: never silently substitute an immediate trade for an unsupported conditional action.

---

## 18. Agent Studio phase

Only add if the manual product is complete.

Natural persistent mandate:

> Keep my NVIDIA exposure usable on Venus, but never migrate if the conversion would reduce normalized exposure by more than 50 bps.

Agent responsibility:
- monitor destination availability / representation status;
- prepare route when action is necessary;
- never override deterministic policy;
- require the configured authorization model before spending.

Do not turn EquityRelay into a chat app.

---

## 19. Build sequence

### Phase 0 — repo discipline

- create repo;
- add README scaffold;
- add `BUILD_SPEC.md`, `UX_SPEC.md`, `DEVEX_LOG.md`;
- `.env.example` with variable names only;
- `.gitignore` credentials;
- Node version and lockfile;
- CI typecheck/test/lint.

### Phase 1 — tracer bullet, read only

One page takes a wallet address + source amount and renders:
- live NVDAon/NVDAB data;
- live two-leg quotes;
- normalized retention;
- live Venus investment availability;
- PASS/BLOCK.

No signing.

### Phase 2 — production UX skeleton

- landing page;
- `/app` destination-first flow;
- route review;
- activity/receipt fixture;
- responsive polish.

### Phase 3 — transaction builders/preflight

- build leg transactions;
- simulation where supported;
- DeFi deposit preview;
- exact error surfaces.

Still no automatic broadcasting.

### Phase 4 — tiny mainnet conversion

- execute leg 1;
- confirm;
- re-quote/recheck leg 2;
- execute leg 2;
- confirm;
- generate conversion receipt.

### Phase 5 — Venus

- simulate deposit;
- execute tiny deposit;
- verify resulting position;
- final end-to-end receipt.

### Phase 6 — Agentic Wallet

Integrate only after the manual path is stable.

### Phase 7 — optional Agent Studio

Persistent mandate, only if it improves the real product and time remains.

### Phase 8 — judge polish

- live proof card on landing;
- one deliberately BLOCKED scenario;
- public proof URLs;
- README architecture diagram;
- short demo script;
- final DevEx report.

---

## 20. Stop conditions

Stop scope expansion when the canonical loop is live:

```text
NVDAon
 -> USDT
 -> NVDAB
 -> Venus
 -> verified receipt
```

Do not add a second ticker until that loop works end-to-end on BSC mainnet.

Do not add a second destination until the first receipt is independently verifiable.

Do not add an agent until the manual product already makes sense without one.

---

## 21. 30-second demo target

```text
0-05s  "I own NVIDIA as NVDAon, but Venus accepts NVDAB."
05-10s Choose Venus and a 0.50% max exposure reduction.
10-16s EquityRelay compiles NVDAon -> USDT -> NVDAB and shows projected retention.
16-22s Show PASS and preflight; expand one technical-detail panel briefly.
22-27s Show completed recorded/mainnet receipt and resulting Venus position.
27-30s Change the policy below the route cost -> BLOCKED, nothing prepared/executed.
```

If the audience cannot understand the problem by second 5, simplify the UI/copy rather than adding explanation.
