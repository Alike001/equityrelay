# EquityRelay judge Q&A

## Did EquityRelay execute the route?

No. It reached the first exact approval review in Binance Wallet. The wallet warned about the unverified target and the user cancelled. No approval transaction was signed or broadcast and no allowance was confirmed. The spender investigation and recorded refusal followed afterward.

## Why is that a product result rather than an incomplete demo?

The product promise includes explicit refusal. An authenticated route response proves what the API returned; it does not independently prove who controls the deployed authorization target or what its upgradeable code can do. The operator preserved that boundary. The current provenance decision is documented, not automatically enforced by action delivery.

## What exactly did Binance return?

Three authenticated Web3 API builds identified LiquidMesh and returned `0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5` as both approval spender and swap target.

## Was the approval unlimited?

No. EquityRelay replaced broad approvals with exact route-input amounts. The refusal remained necessary because bounded scope and contract provenance address different risks.

## What was missing?

The BSC diamond and active facets were source-unverified. No primary-source Binance or LiquidMesh deployment registry, ownership statement, or deployment-specific audit naming the exact address was found.

## What did the wallet report?

Binance Wallet warned that approving the unverified contract was high risk. EquityRelay did not bypass or weaken that warning.

## What does `API_PROVENANCE_ONLY` mean?

It means authenticated Binance responses consistently supplied the vendor and address, while independent published deployed-contract attribution remained unavailable.

## Is the router provenance refusal runtime-enforced?

No. `routerSecurityDecision()` currently belongs to the recorded proof/presentation model and is not called by the live server action-delivery gate. Production is disarmed, and the operator refused to proceed after cancellation and investigation.

## What would allow reconsideration?

A primary-source chain-specific contract registry, verified source for the live diamond and every active facet, a deployment-specific audit tied to bytecode hashes, and documented ownership and upgrade authority.

## Are the Venus proof transactions EquityRelay executions?

No. They are clearly labeled historical mainnet protocol fixtures used to validate canonical supply and redemption verifiers.

## Is production armed?

No. `EQUITYRELAY_MAINNET_EXECUTION=false`, and the deprecated backend relay remains permanently locked.
