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
