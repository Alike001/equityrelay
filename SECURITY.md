# EquityRelay execution security review — Phase 3C.1

Reviewed 2026-09-30. This phase used read-only RPC calls, a local PostgreSQL rehearsal and non-verified database fixtures. No wallet was funded. No transaction was signed, approved, submitted or broadcast.

## Trust and authority

- Browser wallet connection is only an address claim. SIWE/EIP-4361 binds the configured origin, URI, claimed address, chain 56, nonce and expiry. The server verifies the signature and atomically consumes the nonce. Only the nonce hash and opaque session-token hash are stored in PostgreSQL. The session cookie is HttpOnly, SameSite=Lax and Secure in production. Origin and JSON content type are required on mutation routes. On refresh, the browser checks the connected account and chain again; a mismatch invalidates readiness and logs out.
- Challenge generation uses PostgreSQL-backed wallet, global and trusted-proxy IP buckets. Production fails closed without an approved proxy IP header and a stable server-only HMAC secret. The edge proxy must overwrite the header. No raw IP, signature or session token is logged.
- PostgreSQL is authoritative for route version, ordered step, confirmation intent, settlement and receipt. `DATABASE_URL` absent is an explicit failure. Migrations are serialized and recorded by `npm run migrate`. Financial quantities remain integer/decimal strings. The local PostgreSQL 16 integration test covered restart, rollback, uniqueness, token replay and a two-request route-version race. The intended managed deployment remains untested.
- `ExecutionActionV1` binds chain, authenticated sender, target, calldata, native value, route/stage/kind, token identities, exact approval scope and quote/plan identity. Its versioned hash excludes wallet-selected nonce and gas. A regenerated action gets a new revision and hash. Confirmation tokens are random, stored by hash, bound to action and route version, and consumed once under a row lock.
- One financial boundary may contain approval and swap/deposit as separate database steps. The step-order gate requires a confirmed leg-1 swap row before any leg-2 action, and a confirmed leg-2 swap row before any Venus action. A bounded approval must be canonically confirmed before the dependent action unless live allowance suffices.
- Durable leg-2 and Venus review preparation requires a matching `BSC_CANONICAL_RPC` settlement row joined to a confirmed transaction step. Leg 2 uses exact settled USDT, obtains a new quote and rechecks the original exposure policy. A policy failure persists `PARTIAL_ROUTE_STOPPED`. Venus uses exact settled NVDAB, rediscovers the investable market, and preserves the bounded-approval guard. The reviewed route and first action are persisted atomically under route-version locking.
- A browser-reported transaction hash is only a lookup hint. Canonical BSC reads must match action semantics, receipt success, block identity, sender, target, confirmation depth and exact ERC-20 evidence. Pending finality never confirms a step. A bounded lost-hash search returns zero, one or multiple semantic candidates; one candidate still requires canonical verification. Zero and multiple candidates do not become a submitted step. Timed-out reservation release with a no-match scan is available only while the mainnet execution flag is off; an armed route requires manual review. No browser rejection claim alone proves absence of a broadcast.
- The public proof page reads durable server evidence. PENDING, FAILED and PARTIAL_ROUTE_STOPPED show quoted and actual values separately. VERIFIED requires the versioned receipt hash and matching persisted confirmed steps/settlements; no public VERIFIED record was created in this phase.

## BSC and Venus evidence

The production RPC policy is configurable with `BSC_MIN_CONFIRMATIONS` (default 3) and optional `BSC_REQUIRE_FINALIZED`. Read-only calls retry only transient failures. Log reads require a bounded block range, exact contract and topic. The default BSC public RPC returned `-32005: limit exceeded` even for a one-block vNVDAB Mint query. PublicNode accepted recent logs but denied older archive queries and returned HTTP 403 for a recent receipt lookup in one smoke run. `1rpc.io/bnb` passed chain, transaction, receipt, block, finalized-tag and one-block log reads, but caps `eth_getLogs` at 50 blocks per request. No public endpoint has yet been selected as a production service-level provider.

The live vNVDAB market returned underlying NVDAB, symbol `vNVDAB`, and delegate `0xCDfea50f7CECCB24Fe804657DB8E6c93b689941e`. [Official Venus Core documentation](https://github.com/venusprotocol/venus-protocol-documentation/blob/main/technical-reference/reference-core-pool/vtoken.md) identifies that delegate for BNB Core ERC-20 markets. The [official interface](https://github.com/VenusProtocol/venus-protocol/blob/develop/contracts/Tokens/VTokens/VTokenInterfaces.sol) declares four-field `Mint` and `MintBehalf` events.

Historical mainnet transaction `0x5516148304443e2461c673f914d3de4140b8f45ef511df05b311fc68c4c55766` at block `124836339` validates the direct supply path. The verifier requires a successful canonical receipt, the exact live market and underlying, zero native value, decoded `mint(uint256)` semantics, one matching Mint event, one exact NVDAB transfer into the market, one exact vNVDAB transfer to the receiver, and matching before/after `balanceOf` plus `getAccountSnapshot` position evidence. The verified amounts were 1.099946467462607788 NVDAB and 1.09994646 vNVDAB. Negative fixtures fail closed for missing or ambiguous events, identity, sender, amount, receipt, or position mismatches. The Venus evidence gate is now `READY`; current market identity must still be reacquired for each future deposit. This historical transaction is not an EquityRelay execution.

The hard mainnet test-spending cap is $2. Current Binance minimum-order evidence makes the proven 0.05 NVDAon route incompatible with that cap, so funded mainnet execution is not a release requirement. Execution locks remain mandatory.

## Execution locks

`EQUITYRELAY_MAINNET_EXECUTION` defaults to false. `requireBroadcastRelease()` always throws `PHASE3A_BROADCAST_DISABLED`. The built server returned HTTP 423 `MAINNET_EXECUTION_NOT_ARMED` with the flag false, and HTTP 423 `PHASE3A_BROADCAST_DISABLED` with it true. There is no enabled wallet transaction control, backend private key or Agentic Wallet path.

## Required before a separate lock-removal commit

1. Deploy and rehearse managed PostgreSQL with TLS, backup, restricted credentials and restart/redeploy persistence.
2. Complete real connected-wallet SIWE browser tests at the final HTTPS origin, including account/chain changes, replay, expiry, wrong signer, logout and reload.
3. Verify trusted edge IP headers and rate limits under production concurrency.
4. Select a production BSC RPC with reliable transaction, receipt, finalized, exact-log and archive access; test confirmation counting and timeout/rate behavior.
5. Revalidate the live vNVDAB market, underlying and implementation immediately before any future deposit, and retain regression coverage against the historical canonical fixture.
6. Review lost-hash and abandoned-prompt behavior under possible delayed wallet broadcasts; do not equate zero recent matches with proof of no submission.
7. Rehearse each enabled action's live balance, allowance, gas, quote freshness, bounded approval and exposure-policy checks; verify restart/two-tab behavior in the deployed runtime.
8. Obtain a distinct security review and explicit authorization for any later funded mainnet proof. Removing the code lock must be a separate reviewed commit.
