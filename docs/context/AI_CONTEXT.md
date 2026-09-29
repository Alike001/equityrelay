# AI Context: BNB Chain

Use this file as project context for an AI coding/research agent.

## Goal

When designing on BNB Chain, choose the smallest set of primitives that solves the product problem. Do not add BSC, opBNB, Greenfield, AI agents, bridges, or DeFi integrations merely to increase integration count.

## Network model

### BNB Smart Chain (BSC)
- Main EVM-compatible execution layer.
- Chain ID 56 mainnet, 97 testnet.
- Solidity, Foundry, Hardhat, Remix, ethers, viem and normal Ethereum tooling apply.
- BNB pays gas.
- Native staking is managed through BSC system contracts such as StakeHub.

### opBNB
- EVM L2 in the BNB ecosystem.
- Use when cheap/high-frequency execution is materially useful.
- Do not move a simple BSC application to opBNB without a reason.

### BNB Greenfield
- Decentralized storage/data layer.
- Core objects: buckets, objects/files, groups, permissions and payment accounts.
- BSC/opBNB contracts can participate in Greenfield access control through cross-chain contracts and mirrored resources.
- JS SDK: `@bnb-chain/greenfield-js-sdk`.

## Major ecosystem primitives

### PancakeSwap
Role: DEX/liquidity layer.
Use for: swaps, routing, liquidity, token markets, price discovery.
Builder question: Does the product genuinely need exchange/liquidity logic, or is a simple transfer enough?

### Venus Protocol
Role: lending/borrowing money market.
Use for: supplying assets, borrowing against collateral, lending integrations and liquidation-aware products.
Important: Venus includes isolated lending pools and configurable oracle/risk infrastructure. Never assume all collateral has the same risk parameters.

### Lista DAO
Role: liquid staking + stablecoin + lending stack.
Key concepts: slisBNB liquid-staked BNB, lisUSD over-collateralized stablecoin, Lista Lending.
Use for: BNB yield-bearing collateral, borrowing stable liquidity, lending strategies.

### Four.Meme
Role: BSC-native token launch/fair-launch surface.
Use for: token creation, token launch/trading workflows, launch analytics and agent-driven token tooling.
It also exposes an agent skill capable of token operations and ERC-8004 registration.

### BNB native staking
Role: network security and staking rewards.
StakeHub handles validator/delegation operations.
Use for: staking dashboards, delegation tools, reward accounting, validator tooling.

### Bridges
BNB Chain Canonical Bridge is an aggregator/widget + SDK, not a single monolithic bridge protocol. It can route through bridge providers.
Use for: onboarding liquidity/assets from other chains or multi-chain apps.
Treat bridging as a high-risk boundary. Explicitly validate chain, asset, destination, route and amount.

### Oracles
BNB docs list Binance Oracle and additional oracle tooling depending on network. BNB ecosystem protocols also use providers such as Chainlink, RedStone, Atlas, Supra and Pyth depending on the application.
Use for: prices, external facts, randomness, liquidation logic.
Never treat one oracle provider as universally correct. Use the exact feed/contract and freshness rules required by the chosen protocol.

### Wallets / account layer
BSC supports normal EVM wallets. BNB docs list MetaMask, Trust Wallet, Binance Web3 Wallet, OKX Wallet, Particle and others.
Use WalletConnect or a mature wallet connector rather than building key management in a frontend.

### Paymaster / gas sponsorship
BNB Chain has an EOA-oriented paymaster design. MegaFuel is one implementation referenced by BNB docs.
Use for: gasless/sponsored onboarding when the product benefits from removing the initial BNB requirement.
Do not hide transaction meaning from users merely because gas is sponsored.

## AI and agent stack

### bnbchain-mcp
Official MCP toolkit for AI-assisted blockchain interaction.
Capabilities include blocks, transactions, contracts, ERC-20/NFT operations, wallet actions, Greenfield operations and ERC-8004 agent tools.
Security rule: its README warns against exposing the unauthenticated SSE endpoint publicly and recommends preview-then-confirm for transfers/payments.

### bnbagent-sdk
Python and TypeScript SDKs for on-chain agents.
Core protocols:
- ERC-8004: on-chain agent identity/discovery.
- ERC-8183: agentic commerce/jobs with on-chain escrow and policy-based settlement.
Potential product shapes: paid specialist agents, marketplaces of agents, autonomous service providers, trust-minimized agent jobs.

### BNB Agent Studio / bnbchain-skills
BNB Chain distributes skills/plugins for Claude Code, Cursor and Codex. Agent Studio uses the `bag` CLI and is designed around building, running, diagnosing, deploying and monetizing seller agents.
Current design guidance emphasizes deterministic pricing/signing and keeping LLM chain tools read-only where possible.

## Builder repos to inspect first

- `bnb-chain/example-hub`
- `bnb-chain/hackathon-starter-kit`
- `bnb-chain/bnbchain-mcp`
- `bnb-chain/bnbagent-sdk`
- `bnb-chain/bnbchain-skills`
- `bnb-chain/canonical-bridge`
- `bnb-chain/greenfield-js-sdk`
- `bnb-chain/BEPs`
- `bnb-chain/bsc`
- `bnb-chain/opbnb`
- `bnb-chain/greenfield`

## Repo hygiene

Avoid using archived/legacy repositories as a starting point unless investigating history. Examples seen during research include `zkbnb`, `bsc-explorer`, old `python-sdk`, `BSC-Truffle-Starter-Box`, old bridge/relayer repos and `bsc-use-wallet`.

`bnb-chain/bsc-builder` explicitly says it is no longer maintained. Use the current BSC client/BEP specifications instead of treating that implementation as production reference code.

## Product design rule for hackathons

A strong BNB project should be explainable as:

`user problem -> BNB-native primitive -> verifiable on-chain/storage action -> clear return loop`

Prefer one or two deep integrations over five shallow integrations.

Good examples of deep integration:
- BSC escrow + ERC-8004 identity + ERC-8183 paid work.
- Greenfield private data + BSC programmable access control.
- BNB staking + a reward/accounting product using StakeHub events.
- PancakeSwap execution + oracle/risk controls for an actual financial workflow.
- Canonical Bridge + destination-chain action, rather than a bridge-only UI clone.
