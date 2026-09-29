# EquityRelay execution security review — Phase 3B

Reviewed 2026-09-29. Phase 3B added read-only execution prerequisites. No wallet was funded; no transaction was signed or broadcast.

## Trust boundaries

- A connected address is a claim until SIWE/EIP-4361 signature verification succeeds. The server creates the domain, URI, chain-56 challenge and one-time nonce. The nonce and opaque session identifier are stored as hashes in PostgreSQL. Mutation routes require the configured same Origin and JSON content type. The session cookie is HttpOnly, SameSite=Lax and Secure in production. Execution route creation takes the wallet only from that session.
- PostgreSQL is authoritative for route lifecycle, version, per-transaction step, confirmation intent, settlement evidence and receipt status. `DATABASE_URL` absent is an explicit failure; there is no in-memory execution fallback. Apply migrations `001_execution.sql` and `002_reservation_time.sql` in order. Validate locally with `npm run migrate:validate`.
- `ExecutionActionV1` hashes route, stage, action kind, chain, authenticated sender, target, calldata, native value, asset identities, approval scope, quote/investment identity and a server plan revision. Nonce and gas fields are outside the semantic hash; gas has a separate policy check. Every regenerated action gets a new plan revision.
- Confirmation tokens are random and stored only by SHA-256 hash. PostgreSQL row locks and route versions make consumption atomic. A token binds the wallet, route, stage, action hash, version and expiry. A rejected or expired wallet prompt requires a new review and token; no consumed token is restored. Each approval, swap and deposit is a separate `execution_steps` record.
- The intended future path is connected-wallet signing and broadcasting, with a reported hash used only as a lookup hint. No wallet transaction broadcast method is called in Phase 3B. Internal reconciliation checks the canonical BSC transaction against the reserved action; wallet-selected nonce/gas are recorded separately. The old Binance relay path remains unreachable behind `PHASE3A_BROADCAST_DISABLED`.
- Canonical BSC verification checks RPC chain 56, transaction semantics, receipt success, block identity and configurable confirmation depth. `BSC_MIN_CONFIRMATIONS` defaults to 3 as a local policy, with optional `BSC_REQUIRE_FINALIZED=true`. Missing required finality remains PENDING. A swap requires unique, expected ERC-20 Transfer logs and exact source debit before actual USDT/NVDAB can be recorded. Approval requires an exact Approval event. Binance transaction status alone cannot advance a step.
- The Venus vNVDAB target returned in Phase 2A has live contract code; read-only BSC RPC calls on 2026-09-29 returned `underlying()` = NVDAB `0x02fca66c1d1afb4e2a7884261eb00f63598a7436` and `symbol()` = vNVDAB. Historical `Mint(address,uint256,uint256)` log queries over 100 and 1,000 recent blocks both returned RPC error `-32005: limit exceeded` on the public endpoint. The exact supply event and resulting position path have not yet been characterized against a confirmed deposit. Venus verification remains `NOT_READY`, so no deposit or public receipt can become VERIFIED through the Phase 3B verifier.
- `EquityRelayExecutionReceiptV1` uses deterministic canonical serialization and a Keccak-256 receipt hash. The public proof page reads durable server evidence, distinguishes pending/failed/partial/verified states, and never accepts browser claims as a receipt.

## Current locks and review before release

`EQUITYRELAY_MAINNET_EXECUTION` defaults to false. `requireBroadcastRelease()` still always throws `PHASE3A_BROADCAST_DISABLED`; setting the flag true is insufficient. The app has no enabled wallet transaction controls. Removing the code lock requires a distinct reviewed commit after: production PostgreSQL and RPC deployment, authenticated per-step UI, live quote/allowance/balance/gas checks, safe lost-prompt recovery review, finalized canonical receipt tests, live Venus event/position characterization, end-to-end restart and two-tab tests against deployed infrastructure, and a separately authorized tiny funded proof. No Agentic Wallet or backend private-key path is present.

## Remaining implementation limits

The read-only public BSC RPC smoke check observed chain `0x38`, transaction and receipt lookup, block lookup and a responding `finalized` tag. Production RPC reliability and finality semantics still need validation on the selected provider. The current UI deliberately does not issue confirmation intents or call wallet transaction submission. A reported-hash reconciliation service exists internally but has no browser route. A future release must review ambiguous or lost wallet-prompt outcomes before permitting another transaction attempt; a browser rejection claim alone is not proof that no transaction was sent. Venus verification is intentionally incomplete.

## Phase 3A baseline

Reviewed 2026-09-29. No mainnet transaction was signed or broadcast in that phase.

## Reachable server routes

- `/api/route/preview` and `/api/route/preflight` accept only the strict NVIDIA route intent. They use live server-side RWA, quote and DeFi discovery. Neither route submits a transaction.
- `/api/proof/readiness` is local-development-only, accepts only an address, and makes read-only balance, quote, build and gas requests.
- `/api/route/execute` accepts only an opaque intent ID, confirmation token and one of three confirmation boundaries. Unknown fields, including `to`, calldata, quote ID, value, token and spender, are rejected. It returns `423` when `EQUITYRELAY_MAINNET_EXECUTION` is absent or not exactly `true`. Even when set to `true`, the Phase 3A code-level broadcast lock returns `423`.
- `/proof/route/[id]` has no receipt store and displays “No verified route yet.” It never synthesizes a transaction hash.

## Execution invariants

- The submission service accepts a server-resolved plan reference and compares a wallet-signed serialized EVM transaction against the planned chain, sender, target, calldata, gas limit and zero native value. It requires the future durable plan store to revalidate current state before the broadcast lock. It has no browser route in Phase 3A. The broadcast call is unreachable behind `requireBroadcastRelease()`, which always throws.
- Bounded approval review checks the token, exact raw amount and spender. A live allowance reader can skip an approval only when on-chain allowance covers the requirement. A missing RPC fails closed.
- Approval confirmation is required before its swap or deposit. A hash or pending status never counts as confirmation; failed status ends the route.
- Leg 2 cannot be quoted or built before a confirmed leg-1 receipt yields actual USDT transfer evidence. The new quote must have a new ID, exact settled USDT input and a later observation time. The original exposure policy is rechecked. Failure enters `PARTIAL_ROUTE_STOPPED`; no automatic rollback or retry exists.
- Venus cannot be prepared before a confirmed leg-2 receipt yields actual NVDAB transfer evidence. Investment discovery is repeated and must remain investable. The DeFi builder retains the Phase 2B broad-approval rejection and exact replacement.
- A verified receipt requires confirmed swap and deposit transactions, plus confirmed approvals wherever allowance was insufficient. Quoted and settled amounts have separate fields.

## Required before Phase 3B

Implement authenticated user-wallet binding, durable encrypted-at-rest execution sessions and receipts, single-use confirmation tokens, atomic nonce/replay protection, a connected-wallet signing UI, production BSC RPC configuration, receipt cross-checking against canonical BSC logs, and live funded validation of gas and allowance behavior. Review those changes before removing the Phase 3A broadcast lock. The `EQUITYRELAY_MAINNET_EXECUTION` flag alone cannot enable execution.

No raw private key or seed phrase is accepted or stored.
