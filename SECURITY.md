# EquityRelay execution security review — Phase 3A

Reviewed 2026-09-29. No mainnet transaction was signed or broadcast in this phase.

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
