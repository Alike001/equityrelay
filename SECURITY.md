# EquityRelay execution security review — Phase 3D

Reviewed 2026-09-30. This phase used read-only RPC calls, local fixtures, and a managed PostgreSQL/Vercel production rehearsal. No wallet was funded. No transaction was signed, approved, submitted or broadcast.

## Production rehearsal result

- Vercel production: `https://equityrelay.vercel.app`, HTTPS origin matched exactly.
- Managed PostgreSQL: Neon free deployment attached through the Vercel marketplace. All four migrations applied. A labeled non-chain fixture containing a route, step, consumed confirmation intent and non-verified receipt survived a full production redeploy, was checked afterward, and was removed. The production readiness endpoint read the durable migration table after deployment.
- Production RPC: 1RPC BNB, chain 56, minimum three confirmations, finalized evidence required. The readiness endpoint returned a finalized block and `READY_READ_ONLY`.
- Authentication infrastructure: production challenge creation persisted successfully and the wallet rate bucket returned `AUTH_RATE_LIMITED` after its configured limit. A real intended-wallet SIWE signature, refresh, account switch, chain switch, logout and replay rehearsal remains BLOCKED pending user interaction.
- Execution: `POST /api/route/execute` returned HTTP 423 `MAINNET_EXECUTION_NOT_ARMED`. The environment arm remains false and `PHASE3A_BROADCAST_DISABLED` remains compiled into the submission adapter.

## Trust and authority

- Browser wallet connection is only an address claim. SIWE/EIP-4361 binds the configured origin, URI, claimed address, chain 56, nonce and expiry. The server verifies the signature and atomically consumes the nonce. Only the nonce hash and opaque session-token hash are stored in PostgreSQL. The session cookie is HttpOnly, SameSite=Lax and Secure in production. Origin and JSON content type are required on mutation routes. On refresh, the browser checks the connected account and chain again; a mismatch invalidates readiness and logs out.
- Challenge generation uses PostgreSQL-backed wallet, global and trusted-proxy IP buckets. Production fails closed without an approved proxy IP header and a stable server-only HMAC secret. The edge proxy must overwrite the header. No raw IP, signature or session token is logged.
- PostgreSQL is authoritative for route version, ordered step, confirmation intent, settlement, recovery state and receipt. `DATABASE_URL` absent is an explicit failure. Migrations are serialized and recorded by `npm run migrate`. Financial quantities remain integer/decimal strings. Migration 004 adds durable recovery state and a versioned round-trip receipt. The local PostgreSQL 16 integration test covered restart, rollback, uniqueness, token replay and a two-request route-version race. Managed deployment evidence is recorded separately from local tests.
- `ExecutionActionV1` binds chain, authenticated sender, target, calldata, native value, route/stage/kind, token identities, exact approval scope and quote/plan identity. Its versioned hash excludes wallet-selected nonce and gas. A regenerated action gets a new revision and hash. Confirmation tokens are random, stored by hash, bound to action and route version, and consumed once under a row lock.
- One financial boundary may contain approval and swap/deposit as separate database steps. The step-order gate requires a confirmed leg-1 swap row before any leg-2 action, and a confirmed leg-2 swap row before any Venus action. A bounded approval must be canonically confirmed before the dependent action unless live allowance suffices.
- Durable leg-2 and Venus review preparation requires a matching `BSC_CANONICAL_RPC` settlement row joined to a confirmed transaction step. Leg 2 uses exact settled USDT, obtains a new quote and rechecks the original exposure policy. A policy failure persists `PARTIAL_ROUTE_STOPPED`. Venus uses exact settled NVDAB, rediscovers the investable market, and preserves the bounded-approval guard. The reviewed route and first action are persisted atomically under route-version locking.
- A browser-reported transaction hash is only a lookup hint. Canonical BSC reads must match action semantics, receipt success, block identity, sender, target, confirmation depth and exact ERC-20 evidence. Pending finality never confirms a step. A bounded lost-hash search returns zero, one or multiple semantic candidates; one candidate still requires canonical verification. Zero and multiple candidates do not become a submitted step. Timed-out reservation release with a no-match scan is available only while the mainnet execution flag is off; an armed route requires manual review. No browser rejection claim alone proves absence of a broadcast.
- The public proof page reads durable server evidence. PENDING, FAILED and PARTIAL_ROUTE_STOPPED show quoted and actual values separately. A round-trip VERIFIED record is written only after confirmed product swaps, canonical Venus supply, canonical redeem, and canonical final NVDAB to USDT settlement. Its receipt hash covers separate capital-in, actual-recovered, gas and friction fields. No public VERIFIED record was created in this phase.

## Durable recovery boundary

- Test setup remains separate from the EquityRelay route and must canonically verify actual NVDAon received before product execution.
- Product stops persist `RECOVERABLE_AS_USDT`, `RECOVERABLE_AS_NVDAB`, or `RECOVERABLE_FROM_VENUS` from server evidence. These labels describe custody location and do not promise principal recovery.
- Venus redemption uses a fresh live market discovery and exact `redeem(uint256)` calldata. Canonical verification requires the expected market, successful receipt, one unambiguous Redeem event, exact NVDAB transfer to the authenticated wallet, and block-specific vToken/account position evidence.
- The final exit review is created only from actual canonically redeemed NVDAB, obtains a fresh quote, and uses an exact bounded approval when required. Earlier read-only exit quotes cannot authorize execution.

## BSC and Venus evidence

The production RPC policy is configurable with `BSC_MIN_CONFIRMATIONS` (default 3) and optional `BSC_REQUIRE_FINALIZED`. Read-only calls retry only transient failures. Log reads require a bounded block range, exact contract and topic. The deployment rehearsal selected `https://1rpc.io/bnb`: it passed chain, transaction, receipt, block, finalized-tag and bounded-log reads, but caps `eth_getLogs` at 50 blocks per request. This is the configured proof-rehearsal RPC; its public service limits remain a lock-removal risk.

The live vNVDAB market returned underlying NVDAB, symbol `vNVDAB`, and delegate `0xCDfea50f7CECCB24Fe804657DB8E6c93b689941e`. [Official Venus Core documentation](https://github.com/venusprotocol/venus-protocol-documentation/blob/main/technical-reference/reference-core-pool/vtoken.md) identifies that delegate for BNB Core ERC-20 markets. The [official interface](https://github.com/VenusProtocol/venus-protocol/blob/develop/contracts/Tokens/VTokens/VTokenInterfaces.sol) declares four-field `Mint` and `MintBehalf` events.

Historical mainnet transaction `0x5516148304443e2461c673f914d3de4140b8f45ef511df05b311fc68c4c55766` at block `124836339` validates the direct supply path. The verifier requires a successful canonical receipt, the exact live market and underlying, zero native value, decoded `mint(uint256)` semantics, one matching Mint event, one exact NVDAB transfer into the market, one exact vNVDAB transfer to the receiver, and matching before/after `balanceOf` plus `getAccountSnapshot` position evidence. The verified amounts were 1.099946467462607788 NVDAB and 1.09994646 vNVDAB. Negative fixtures fail closed for missing or ambiguous events, identity, sender, amount, receipt, or position mismatches. The Venus evidence gate is now `READY`; current market identity must still be reacquired for each future deposit. This historical transaction is not an EquityRelay execution.

The former $2 planning cap is no longer the active assumption. The minimum tested 0.022 NVDAon route and its source-acquisition quote remain dated read-only evidence. This does not authorize funding or execution. Execution locks remain mandatory.

## Execution locks

`EQUITYRELAY_MAINNET_EXECUTION` defaults to false. `requireBroadcastRelease()` always throws `PHASE3A_BROADCAST_DISABLED`. The built server returned HTTP 423 `MAINNET_EXECUTION_NOT_ARMED` with the flag false, and HTTP 423 `PHASE3A_BROADCAST_DISABLED` with it true. There is no enabled wallet transaction control, backend private key or Agentic Wallet path.

## Required before a separate lock-removal commit

1. Confirm the managed Neon backup/retention policy and use restricted production credentials for any execution-enabled environment.
2. Complete real connected-wallet SIWE browser tests at the final HTTPS origin, including account/chain changes, replay, expiry, wrong signer, logout and reload.
3. Verify trusted edge IP headers and rate limits under production concurrency.
4. Select a production BSC RPC with reliable transaction, receipt, finalized, exact-log and archive access; test confirmation counting and timeout/rate behavior.
5. Revalidate the live vNVDAB market, underlying and implementation immediately before any future deposit, and retain regression coverage against the historical canonical fixture.
6. Review lost-hash and abandoned-prompt behavior under possible delayed wallet broadcasts; do not equate zero recent matches with proof of no submission.
7. Rehearse each enabled action's live balance, allowance, gas, quote freshness, bounded approval and exposure-policy checks; verify restart/two-tab behavior in the deployed runtime.
8. Obtain a distinct security review and explicit authorization for any later funded mainnet proof. Removing the code lock must be a separate reviewed commit.
