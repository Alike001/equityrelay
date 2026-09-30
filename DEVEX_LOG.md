# EquityRelay Developer Experience Log

Append genuine findings as implementation proceeds. The entry below is pre-build research evidence, not an issue discovered during this application build.

## Pre-build research evidence

### 2026-09-29 — Direct cross-issuer quote rejected

- **API / surface:** Binance Web3 Trading API aggregator quote.
- **Attempt:** Quote direct NVDAon → NVDAB at approximately $10, $100, and $500 on BSC.
- **Expected:** The aggregator might route internally through an allowed stable asset.
- **Actual:** Each direct quote returned HTTP 200 with business code `40368`. Explicit NVDAon → USDT → NVDAB quotes succeeded at all three sizes.
- **Error/code:** `40368`: `Ondo asset on chain 56 can only pair with allowed stablecoin(s)`.
- **Impact:** The route must explicitly include an allowed settlement asset.
- **Workaround:** Compile NVDAon → USDT → NVDAB as two bounded legs.
- **Suggested improvement:** Expose allowed settlement assets in RWA metadata so route builders can discover valid paths before quoting.
- **Evidence:** [Feasibility result](docs/context/FEASIBILITY_RESULT_2026-09-29.md).

## Phase 2A implementation findings

### 2026-09-29 19:57 WAT — EVM simulation connector schema mismatch

- **API / surface:** Binance Web3 JavaScript connector `TransactionApi.simulateTransactions` and live `/api/v1/dex/pre-transaction/simulate`.
- **Attempt:** Prepare a BSC EVM simulation for a Binance-built swap transaction.
- **Expected:** Supply `binanceChainId: "56"` and only the matching `evmTx` payload, as the connector documentation describes.
- **Actual:** The generated connector method marks `evmTx`, `solTx`, and `tronTx` all required and asserts each is present. A raw signed request containing only `evmTx` was accepted by the live API and returned a simulation result.
- **Error/code:** No live API error. This is a generated SDK request-schema mismatch.
- **Impact:** Using the generated method would require meaningless chain payloads or a local workaround.
- **Workaround:** Use the existing server-side HMAC client to send only the EVM payload.
- **Suggested improvement:** Make the chain-specific payloads optional in generated types and runtime validation, with exactly one required by `binanceChainId`.
- **Evidence:** Official connector source at commit `b1fe19c`, `clients/web3-wallet/src/rest-api/modules/transaction-api.ts`; live read-only preflight request on 2026-09-29.

### 2026-09-29 19:57 WAT — Venus simulation blocked by empty wallet state

- **API / surface:** Binance DeFi Transaction `/api/v1/defi/transaction/deposit`.
- **Attempt:** Build an indicative NVDAB Venus deposit with `simulate=true` using the live discovered investment and the quoted leg-2 output.
- **Expected:** Ordered unsigned actions plus a simulation preview, or a truthful failure reason.
- **Actual:** The simulation request returned business code `40484` with an insufficient-balance message. A separate `simulate=false` read-only build returned ordered `APPROVE` then `DEPOSIT` actions; it did not provide a successful simulation.
- **Error/code:** `40484`: `Insufficient balance. Please check your available funds and try again.`
- **Impact:** A quote-only taker address without NVDAB cannot yield a successful deposit simulation; this does not establish a broken Venus integration.
- **Workaround:** Display `BLOCKED_BY_WALLET_STATE`, preserve the failed simulation reason, and use the build-only result solely to inspect unsigned actions. No funds were moved.
- **Suggested improvement:** Return `dataList` alongside a failed `preview` when the failure is limited to current wallet balance.
- **Evidence:** Live local read-only preflight on 2026-09-29; no transaction hash exists.

### 2026-09-29 19:57 WAT — Venus build requests a broad approval

- **API / surface:** Binance DeFi Transaction deposit `dataList`.
- **Attempt:** Inspect the approval calldata returned by the build-only fallback for an indicative NVDAB deposit.
- **Expected:** A bounded approval amount or an explicit indication of approval scope.
- **Actual:** The ordered `APPROVE` item encoded the maximum uint256 allowance (`115792089237316195423570985008687907853269984665640564039457584007913129639935`), greater than the indicative deposit amount. The following `DEPOSIT` target was the Venus vNVDAB contract.
- **Error/code:** No API error; this is the returned approval calldata.
- **Impact:** The approval scope is broader than the intended deposit amount, so EquityRelay marks the preflight unsafe and exposes the scope for review.
- **Workaround:** Validate and display the exact requested spender/amount; block a ready-to-continue verdict. Nothing was signed or submitted.
- **Suggested improvement:** Provide a deposit-builder option for an exact-amount approval and an explicit approval-scope field.
- **Evidence:** Live local read-only preflight on 2026-09-29; decoded ERC-20 `approve(address,uint256)` calldata.

### 2026-09-29 20:29 WAT — Trading `approveAmount` matched both live swap approvals

- **API / surface:** Binance Trading `buildSwapTransaction` for BSC.
- **Attempt:** Request `approveAmount` equal to each leg's exact input raw units for a live 0.05 NVDAon route, then ABI-decode the returned approval calldata.
- **Expected:** Each returned approval amount would equal the requested route amount.
- **Actual:** Leg 1 returned 0.05 NVDAon (50000000000000000 raw), and indicative leg 2 returned 11.421219988624968028 USDT (11421219988624968028 raw), each equal to its `approveAmount`. Additional read-only 0.10 and 0.25 NVDAon probes also returned exact requested approvals on both legs. All approved the Binance-returned swap target. These observations do not guarantee all routes.
- **Error/code:** None.
- **Workaround:** EquityRelay compares the ABI-decoded amount with the exact route input and fails closed with `BLOCK_AUTHORIZATION_SCOPE` if Binance ever returns more.
- **Suggested improvement:** Return a structured approval token, spender, and amount alongside `signatureData` to make the scope easier to audit.
- **Evidence:** Live read-only Phase 2B preflight on 2026-09-29; no transaction was submitted.

### 2026-09-29 20:35 WAT — Trading simulation has no documented ordered approval-state input

- **API / surface:** Binance Transaction `simulateTransactions` (`/api/v1/dex/pre-transaction/simulate`).
- **Attempt:** Inspect the current official connector request type and method for an ordered approval → swap simulation, and compare with the observed live single-swap simulation.
- **Expected:** A documented way to pass an approval and swap as an ordered stateful batch, if supported.
- **Actual:** The documented EVM request contains one `evmTx` object with `from`, `to`, `value`, and `data`; no ordered transaction array or state override is exposed in the inspected connector. Separate live simulations of the unsigned NVDAon, USDT, and locally bounded NVDAB approvals each returned `PASSED`. The live leg-1 swap simulation still reported insufficient allowance, and leg 2 reported insufficient balance, because those approval simulations did not change wallet state. This does not prove an undocumented capability cannot exist.
- **Error/code:** No API business error for the documentation check; live simulation reason was `execution reverted: ERC20: insufficient allowance`.
- **Workaround:** Model `REQUIRES_PRIOR_APPROVAL_STATE` separately from transaction validity. Do not create allowance or claim a stateful pass in read-only mode.
- **Suggested improvement:** Expose documented ordered transaction simulation or an explicit prior-state override for approval-dependent swaps.
- **Evidence:** Official connector source commit `b1fe19c`, `SimulateTransactionsRequestEvmTx` and `TransactionApi.simulateTransactions`; live 2026-09-29 preflight.

### 2026-09-29 20:27 WAT — DeFi deposit builder has no documented approval scope option

- **API / surface:** Binance DeFi `buildDeFiDepositTransaction`.
- **Attempt:** Inspect the current connector request parameters and token schema for an approval amount or approval policy; compare with the live Venus NVDAB build.
- **Expected:** An optional exact-spend approval policy, if supported.
- **Actual:** The inspected request accepts address, investmentId, token amount, and simulate, but documents no approval amount or policy. The live builder returned a uint256.max NVDAB approval for an indicative 0.050001119388168954 NVDAB deposit.
- **Error/code:** None; the broad allowance was returned in valid approval calldata.
- **Workaround:** Reject the Binance approval and locally construct an unsigned ERC-20 approval for exactly the indicative deposit amount, after verifying its spender equals the Binance deposit target. Preserve Binance deposit calldata without modification.
- **Suggested improvement:** Let callers choose a bounded approval amount or policy, or return an exact-spend approval by default.
- **Evidence:** Official connector source commit `b1fe19c`, `DefiTransactionApi.buildDeFiDepositTransaction` and request token type; live read-only Phase 2B preflight on 2026-09-29.

## Phase 2C implementation findings

### 2026-09-29 20:56 WAT — Small NVDAon route quotes meet a 5 USD order minimum

- **API / surface:** Binance Trading aggregator quote, NVDAon → USDT on BSC.
- **Attempt:** Read-only quotes for 0.005, 0.01, 0.02, then 0.05 NVDAon with the same quote-context wallet.
- **Expected:** Determine the smallest size accepted by the live route, without assuming a documented protocol minimum.
- **Actual:** The first three sizes each returned a Binance business error. The 0.05 size quoted through both legs, passed the 0.50% exposure-loss policy, and produced a Venus deposit build. This establishes the smallest viable size among the tested candidates, not a globally exact minimum.
- **Error/code:** `40375`: `Minimum order amount is 5 USD.` for each of the first three sizes.
- **Workaround:** Classify these probes as `BELOW_MINIMUM` and continue in ascending size order until the first full route passes.
- **Suggested improvement:** Return a machine-readable minimum order amount and quote currency in token-pair metadata.
- **Evidence:** Live local read-only readiness check on 2026-09-29; no transaction submitted.

### 2026-09-29 20:56 WAT — Zero relevant token balances were omitted

- **API / surface:** Binance Wallet `/api/v1/dex/balance/token-balances-by-address`.
- **Attempt:** Query the quote wallet for BSC native BNB using an empty token contract address, plus live discovered NVDAon/NVDAB and BSC USDT contract addresses.
- **Expected:** A balance response limited to those four requested assets.
- **Actual:** The request succeeded, including the native-asset query format, and returned no token asset rows for this wallet. The application represents each requested missing asset as zero and `reported=false`; it does not infer any unrelated holding.
- **Error/code:** None.
- **Workaround:** Keep `reported` separate from the zero balance so the UI can state that the zero is inferred from omission.
- **Suggested improvement:** Return explicit zero rows for requested tokens, or document the omission behavior alongside the endpoint schema.
- **Evidence:** Live local read-only readiness check on 2026-09-29; full wallet address and balances are not copied into public evidence.

### 2026-09-29 20:56 WAT — Separate USDT source acquisition was quotable

- **API / surface:** Binance Trading aggregator quote, USDT → NVDAon on BSC.
- **Attempt:** Obtain a read-only reverse quote sized from the current 0.05 NVDAon route's leg-1 quoted USDT output.
- **Expected:** Determine whether stablecoin acquisition of the source representation is available for test setup.
- **Actual:** The live reverse quote returned slightly more than 0.05 NVDAon for the quoted USDT input in two observed runs. This remains a changing quote, not a guaranteed purchase amount. No direct cross-issuer pair or purchase was attempted.
- **Error/code:** None.
- **Workaround:** Keep this quote labeled `TEST_SETUP`, outside the EquityRelay product route.
- **Suggested improvement:** None observed.
- **Evidence:** Live local read-only readiness checks on 2026-09-29; no transaction submitted.

### 2026-09-29 20:57 WAT — Venus gas-limit estimation reverted in the empty wallet state

- **API / surface:** Binance Transaction `/api/v1/dex/pre-transaction/gas-limit` for the unsigned Venus deposit action.
- **Attempt:** Estimate gas for all future proof actions using Binance-built transaction data or the gas-limit endpoint, with no balance or allowance substitutions.
- **Expected:** A positive gas-limit integer for each EVM action.
- **Actual:** The deposit gas-limit request returned an execution-reverted response while the wallet had no NVDAB. The Binance DeFi build itself did not return a deposit `gasLimit` in this wallet state. Other observed build and gas-limit results included 450,000 gas per swap and an estimated 496,600 gas for the separate setup approval plus swap. A complete proof gas total could not be established.
- **Error/code:** `execution reverted` with encoded contract error data from the gas-limit service; no Binance business code was present in the caught message.
- **Workaround:** Expose the known action subtotal and a clearly labeled provisional technical cushion; keep the complete gas estimate unavailable. Do not fabricate a deposit gas limit or wallet balance.
- **Suggested improvement:** Return an indicative gas estimate for a DeFi deposit independently of current balance, or an explicit structured wallet-state error from the gas-limit endpoint.
- **Evidence:** Live local read-only readiness and preflight checks on 2026-09-29; no transaction submitted.

## Phase 3C read-only infrastructure findings

### 2026-09-30 07:20 WAT — Default public BSC RPC rejected one-block Venus log reads

- **API / surface:** BSC JSON-RPC `eth_getLogs` at `https://bsc-dataseed.bnbchain.org/`.
- **Attempt:** Query a single latest block, exact live vNVDAB address, and exact Venus `Mint` event topic. Also tried the older three-field event topic for comparison.
- **Expected:** A bounded array of matching logs, possibly empty.
- **Actual:** Both one-block requests returned RPC error `-32005: limit exceeded`. Earlier 100- and 1,000-block queries returned the same error. This says nothing about whether a Mint event exists.
- **Error/code:** `-32005`, `limit exceeded`.
- **Workaround:** Use a provider that permits exact-address/topic bounded log reads; keep Venus verification `NOT_READY` until a confirmed supply receipt can be checked.
- **Suggested improvement:** Publish the public endpoint's `eth_getLogs` limits and return a machine-readable maximum range or capability error.
- **Evidence:** Live read-only RPC calls on 2026-09-30; no transaction submitted.

### 2026-09-30 07:20 WAT — Alternative public RPC accepts recent logs but restricts archive range

- **API / surface:** BSC JSON-RPC `eth_getLogs` at `https://bsc-rpc.publicnode.com`.
- **Attempt:** Query the exact vNVDAB market and four-field `Mint` topic in consecutive 1,000-block windows near the chain head.
- **Expected:** Bounded log results or an explicit provider limitation.
- **Actual:** Nine recent windows returned empty arrays. The next older window returned an archive-access error. Separate later chain/head reads showed several-second latency, and a longer multi-method smoke attempt timed out at 10 seconds. Empty recent windows are not evidence that no historical supply exists.
- **Error/code:** `Archive requests require a personal token. Get one at: https://www.allnodes.com/publicnode`; one request timed out at the client.
- **Workaround:** Select a production RPC with documented archive, log-range, timeout and rate-limit capacity; retry idempotent reads only.
- **Suggested improvement:** Document available archive depth and return a structured earliest accessible block.
- **Evidence:** Live read-only RPC calls on 2026-09-30; no transaction submitted.

### 2026-09-30 07:20 WAT — Current Venus Core source uses a four-field Mint event

- **API / surface:** Venus Core `VTokenInterfaces.sol` and `VToken.sol` in the official Venus Protocol repository.
- **Attempt:** Inspect the current supply/mint event path for the live NVDAB vToken target.
- **Expected:** Confirm the exact event signature before interpreting receipt logs.
- **Actual:** The current interface declares `Mint(address minter, uint mintAmount, uint mintTokens, uint256 totalSupply)` and `MintBehalf(address payer, address receiver, uint mintAmount, uint mintTokens, uint256 totalSupply)`. The implementation emits Mint and a vToken Transfer after a successful direct mint. The live target's underlying/symbol had already been read as NVDAB/vNVDAB in Phase 3B, but no historical confirmed NVDAB supply receipt was available through the tested public RPCs.
- **Error/code:** No Venus API error; the evidence gap is an unverified live implementation/event match.
- **Workaround:** Decode the four-field event and require matching underlying/vToken transfers in a future confirmed receipt. Keep the live Venus gate `NOT_READY` pending a historical or eventual real confirmed transaction check.
- **Suggested improvement:** None for the Venus contract; use a capable RPC and verified live ABI for the specific market.
- **Evidence:** Official Venus Protocol source inspected on 2026-09-30; local pure decoder tests only, no transaction submitted.

### 2026-09-30 07:41 WAT — 1RPC BSC permits bounded logs but caps each request at 50 blocks

- **API / surface:** BSC JSON-RPC at `https://1rpc.io/bnb`.
- **Attempt:** Read chain, transaction, receipt, block, finalized tag, and exact vNVDAB Mint logs; then probe 10,000-block historical log windows.
- **Expected:** Determine whether one public endpoint can support all canonical verification reads.
- **Actual:** The read-only smoke passed chain ID `0x38`, transaction/receipt/block lookup, finalized tag, and a one-block exact-address/topic log query. A 10,000-block log request returned a documented range refusal. The app's default log page size was reduced to 50 blocks. No confirmed vNVDAB Mint event was found in this bounded smoke.
- **Error/code:** `eth_getLogs is limited to 0 - 50 blocks range`.
- **Workaround:** Page exact-address/topic reads in at most 50-block windows on this endpoint. A capable archive provider or known receipt remains necessary for historical Venus characterization.
- **Suggested improvement:** Return the limit as a structured numeric field and document archive retention.
- **Evidence:** Live read-only RPC calls on 2026-09-30; no transaction submitted.

### 2026-09-30 07:41 WAT — Live vNVDAB implementation matches the documented Venus Core delegate

- **API / surface:** BSC `eth_call` on the live vNVDAB market, cross-checked with the official Venus Core vToken documentation.
- **Attempt:** Read `implementation()`, `underlying()`, and `symbol()` from the live market.
- **Expected:** Establish the current proxy delegate and underlying before choosing a supply-event ABI.
- **Actual:** The market returned implementation `0xCDfea50f7CECCB24Fe804657DB8E6c93b689941e`, underlying NVDAB, and symbol `vNVDAB`. Official Venus documentation identifies that delegate as the current BNB Core ERC-20 market implementation after VIP-640. This strengthens the event-path hypothesis but does not replace a confirmed NVDAB supply receipt.
- **Error/code:** None.
- **Workaround:** Keep the verifier `NOT_READY` until a real historical supply receipt establishes the exact log/position sequence.
- **Suggested improvement:** None observed.
- **Evidence:** Live read-only `eth_call` on 2026-09-30 and official Venus Core vToken documentation; no transaction submitted.

### 2026-09-30 08:53 WAT — Bounded historical log discovery required provider-specific paging

- **API / surface:** BSC JSON-RPC `eth_getLogs` at `https://rpc-bnb.blockmachine.io`.
- **Attempt:** Discover a confirmed vNVDAB supply using the exact market address, exact four-field `Mint` topic, recent ranges first, and bounded pagination.
- **Expected:** Return exact-topic logs without an unrestricted historical scan.
- **Actual:** The endpoint accepted ranges of at most 10,000 inclusive blocks and returned matching logs, but repeated discovery requests reached its 60 compute-unit-per-minute limit.
- **Error/code:** `-32029`, `rate limit exceeded` when the public allowance was exhausted.
- **Workaround:** Use archive-state binary search to narrow supply-changing blocks, then query a single block with the exact market and event topic. Stop after locating a suitable confirmed example.
- **Suggested improvement:** Publish machine-readable block-range and compute-unit limits with retry timing in JSON-RPC error data.
- **Evidence:** Live read-only RPC calls on 2026-09-30; no transaction submitted.

### 2026-09-30 08:53 WAT — Historical direct NVDAB supply established the canonical verifier path

- **API / surface:** BSC transaction, receipt and archive-state reads for live vNVDAB.
- **Attempt:** Validate a real confirmed supply beyond receipt status by matching transaction calldata, Venus event, underlying transfer, vToken transfer and resulting account state.
- **Expected:** One unambiguous direct-mint path whose receipt amounts agree with block-specific position reads.
- **Actual:** Transaction `0x5516148304443e2461c673f914d3de4140b8f45ef511df05b311fc68c4c55766` at block `124836339` called `mint(uint256)` on vNVDAB. It supplied `1099946467462607788` raw NVDAB, emitted one matching `Mint`, minted `109994646` raw vNVDAB to the supplier, and changed that account's vNVDAB balance from zero to exactly `109994646`. The account snapshot agreed.
- **Error/code:** None.
- **Workaround:** Store only the required public chain evidence as a labeled historical mainnet verifier fixture; do not present it as EquityRelay execution.
- **Suggested improvement:** None for the protocol. Production RPC selection should guarantee bounded logs and historical state reads.
- **Evidence:** Canonical BSC read-only transaction, receipt, block and `eth_call` evidence on 2026-09-30; no transaction submitted.

### 2026-09-30 08:53 WAT — Mint ABI field name differs from emitted implementation meaning

- **API / surface:** Venus Core `VTokenInterfaces.sol`, `VToken.sol`, and the historical vNVDAB `Mint` log.
- **Attempt:** Interpret the fourth field of `Mint(address,uint256,uint256,uint256)` and compare it with historical account and global supply state.
- **Expected:** Determine whether the interface field named `totalSupply` represents market supply or receiver position.
- **Actual:** `VToken.sol` emits `accountTokensNew` in the fourth slot. The historical log's value was `109994646`, equal to the receiver's post-mint vToken balance, while the market's global total supply was about `149165307689` raw units. Treating the field as global total supply would be incorrect despite the interface parameter name.
- **Error/code:** No runtime error; this is a source/ABI semantic naming mismatch.
- **Workaround:** Decode the ABI-compatible field and verify it against the receiver's block-specific `balanceOf` and account snapshot.
- **Suggested improvement:** Rename the interface event parameter to `accountTokens` or document that it is the receiver's post-mint balance.
- **Evidence:** Official Venus source plus canonical historical block-state reads on 2026-09-30; no transaction submitted.

### 2026-09-30 12:21 WAT — First viable tested entry size is 0.022 NVDAon

- **API / surface:** Binance Trading quotes and DeFi deposit transaction builder.
- **Attempt:** Probe the untested interval above 0.02 NVDAon in ascending order, requiring both swap quotes, the 0.50% exposure policy, live investable Venus discovery, a deposit build, and safe authorization handling.
- **Expected:** Stop at the first complete route without treating an empty-wallet simulation failure as a route failure.
- **Actual:** `0.021 NVDAon` returned `40375`. `0.022 NVDAon` produced both quotes, `100.005702338352623...%` NVIDIA-equivalent retention, policy `PASS`, and a ready Venus build. The deposit simulation returned `40484: Insufficient balance`, which is wallet-state dependent. The scanner stopped at 0.022 after correcting an application classification that had treated Binance's omitted, unnecessary approval as unavailable instead of `NOT_REQUIRED`.
- **Error/code:** `40375: Minimum order amount is 5 USD`; deposit simulation `40484: Insufficient balance. Please check your available funds and try again.`
- **Workaround:** Treat `NOT_REQUIRED` and exact `BOUNDED_READY` authorization as safe; preserve the wallet-state simulation result separately from route viability.
- **Suggested improvement:** Return a structured simulation failure category so callers do not need to classify wallet balance failures from message text.
- **Evidence:** Live authenticated read-only Binance calls on 2026-09-30; no transaction submitted.

### 2026-09-30 12:21 WAT — Venus exact-amount redeem builds redeem(vTokens), not redeemUnderlying

- **API / surface:** Binance DeFi `/api/v1/defi/transaction/redeem`, live vNVDAB `exchangeRateStored`, and Binance Trading NVDAB → USDT quote.
- **Attempt:** Build and simulate an exact-amount redeem for the indicative 0.022-route NVDAB output, then quote the redeemed underlying back to USDT.
- **Expected:** A validated read-only redemption action or an explicit wallet-state/unsupported result.
- **Actual:** Binance returned one `REDEEM` action, no approval, zero native value, and target vNVDAB. The calldata used `redeem(uint256)` with `2202185` raw vNVDAB rather than `redeemUnderlying(uint256)`. The current canonical exchange rate independently reproduced that exact floored vToken amount and `0.022021850041108519 NVDAB` underlying output. Simulation passed, `redeemDelayDays` was empty, and the fresh quote used that post-floor amount to return `5.026662606796302815 USDT`.
- **Error/code:** None on the successful observation. One earlier read-only request hit the client's network timeout and succeeded on retry.
- **Workaround:** Decode both Venus redeem methods, but accept `redeem(uint256)` only when the calldata amount exactly matches the canonical exchange-rate conversion. Never infer the amount from selector alone.
- **Suggested improvement:** Document that exact-underlying requests may be implemented as a floored vToken `redeem(uint256)` call and return the exchange rate used in the build response.
- **Evidence:** Live authenticated Binance build/simulation/quote plus canonical BSC `eth_call` on 2026-09-30; no transaction submitted.

### 2026-09-30 17:44 WAT — Managed Neon connection emits an upcoming SSL-mode compatibility warning

- **API / surface:** Neon PostgreSQL through Vercel marketplace, Node `pg` connection parsing.
- **Attempt:** Apply EquityRelay migrations to the managed production database and run the durable PostgreSQL rehearsal.
- **Expected:** TLS-protected migration and query execution.
- **Actual:** All four migrations applied successfully. The current `pg` stack warned that `sslmode=require` is presently treated as `verify-full`, but that this alias behavior changes in the next major `pg-connection-string`/`pg` release.
- **Error/code:** Warning only; no failed query or migration.
- **Workaround:** Pin the tested `pg` major and explicitly configure `sslmode=verify-full` when the provider connection format permits it before upgrading.
- **Suggested improvement:** Managed connection strings should state the certificate-verification behavior explicitly and avoid version-dependent SSL aliases.
- **Evidence:** Managed production migration run on 2026-09-30; no transaction submitted.

### 2026-09-30 22:23 WAT — 1RPC intermittently forbids Vercel read-only requests

- **API / surface:** BSC JSON-RPC at `https://1rpc.io/bnb`, called from the production Vercel readiness route.
- **Attempt:** Re-run the production chain/finality readiness probe after a successful deployment.
- **Expected:** Stable chain ID 56 and finalized-block reads.
- **Actual:** One production request returned HTTP 403 for `eth_chainId`; the next three requests returned `READY_READ_ONLY` with finalized block `124975863`. An earlier production request returned HTTP 403 for `eth_getBlockByNumber("finalized")`. At the same time, local read-only probes of chain, finalized block, historical transaction/receipt/block and exact Venus logs all returned HTTP 200.
- **Error/code:** HTTP `403`, `forbidden`.
- **Workaround:** Remove 1RPC as the production verification authority and require a full canonical capability probe against the replacement endpoint. Do not turn a failed RPC check green through error catching.
- **Suggested improvement:** Document serverless-origin filtering and return rate-limit or policy metadata that distinguishes temporary edge rejection from unsupported methods.
- **Evidence:** Repeated production and local read-only calls on 2026-09-30; no transaction submitted.

### 2026-09-30 22:23 WAT — 48 Club RPC passed the complete canonical readiness probe

- **API / surface:** BSC JSON-RPC at the documented `https://rpc.48.club` endpoint.
- **Attempt:** Read chain ID, `finalized`, historical Venus transaction, receipt, containing block, and an exact-address/exact-topic one-block Mint log query.
- **Expected:** One endpoint must supply every canonical evidence class EquityRelay needs before lifecycle advancement.
- **Actual:** All six read-only capabilities returned HTTP 200 and mutually consistent evidence for the historical Venus verifier fixture.
- **Error/code:** None observed.
- **Workaround:** Configure this endpoint for the production read path and keep readiness fail-closed. Continue to treat public-endpoint availability as a release risk until an SLA-backed endpoint is selected.
- **Suggested improvement:** Publish explicit read rate limits, archive depth and availability targets for dApp verification workloads.
- **Evidence:** Live read-only calls on 2026-09-30; no transaction submitted.
