# EquityRelay judge Q&A

## Did EquityRelay execute the route?

No. It reached the first exact approval review, investigated the returned spender, and refused before approval, signature, or broadcast.

## Why is that a product result rather than an incomplete demo?

The product promise includes refusal. An authenticated route response proves what the API returned; it does not independently prove who controls the deployed authorization target or what its upgradeable code can do. EquityRelay preserved that boundary.

## What exactly did Binance return?

Three authenticated Web3 API builds identified LiquidMesh and returned `0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5` as both approval spender and swap target.

## Was the approval unlimited?

No. EquityRelay replaced broad approvals with exact route-input amounts. The refusal remained necessary because bounded scope and contract provenance address different risks.

## What was missing?

The BSC diamond and active facets were source-unverified. No primary-source Binance or LiquidMesh deployment registry, ownership statement, or deployment-specific audit naming the exact address was found.

## What did the wallet report?

Binance Wallet warned that approving the unverified contract was high risk. EquityRelay did not bypass or weaken that warning.

## What does `API_PROVENANCE_ONLY` mean?

It means a signed, authenticated Binance response consistently supplied the vendor and address, while independent published deployed-contract attribution remained unavailable.

## What would allow reconsideration?

A primary-source chain-specific contract registry, verified source for the live diamond and every active facet, a deployment-specific audit tied to bytecode hashes, and documented ownership and upgrade authority.

## Are the Venus proof transactions EquityRelay executions?

No. They are clearly labeled historical mainnet protocol fixtures used to validate canonical supply and redemption verifiers.

## Is production armed?

No. `EQUITYRELAY_MAINNET_EXECUTION=false`, and the deprecated backend relay remains permanently locked.
