# ReceiptLink

Get paid. Send your work. ReceiptLink creates one-time USDC payment links on Monad Testnet and unlocks an optional delivery link after a verified payment.

Built for the Metropolis hackathon, Track 02: Consumer Products & Payments. Intended users are freelancers and digital-product sellers who need to connect a payment request, verifiable settlement and delivery without manually matching wallet transfers to orders.

Live prototype: https://receiptlink.emilpepil.workers.dev

**Known issue: MetaMask displays a security warning on the current hosted URL.** The project owner observed the same warning on the previous URL. The cause has not been established, and a false positive has not been confirmed. Do not bypass the warning or disable wallet protection. The demo and completed two-wallet tests use the local frontend with the deployed Monad Testnet contract. See [judge access instructions](docs/judge-access.md) for a reproducible evaluation path.

Deployed contract: `0xd1e42781571EE350C923ed8c024ffCfCe04b3cbf`. Its deployed runtime and payment token were verified against the local compiled contract. Production smoke checks passed for SPA routing, configuration, signed wallet login, replay rejection, finalized contract reads and session revocation.

A two-wallet payment through the local frontend passed on Monad Testnet: invoice `0x531375820c6da6cc4c66aac14e53d69beab263ef8a10ccc010986703dae7a0fe`, payment transaction `0x28614cab2a8cd8bac3186b39a705659b1d8a7c4f8bcdcde5f826079c77213dd5`. Finality and the direct transfer of 0.1 test USDC from buyer to seller were independently verified. A subsequent invoice with a delivery link was tested by the project owner: payment, payer-only link retrieval, opening the Google Drive file and rejection of the seller wallet all passed.

The project owner contacted MetaMask Support and was directed to its GitHub reporting channel. Both `receiptlink.mongangstudio.workers.dev` and `receiptlink.emilpepil.workers.dev` show a security warning. Redeployment did not resolve it. A review-request draft is available in [docs/metamask-review.md](docs/metamask-review.md); this repository does not claim that a GitHub review has been completed or that either URL has been cleared. The full payment flow on the current hosted URL remains unverified.

## Demo flow

1. A seller connects a browser wallet, signs in and creates an invoice with a title, USDC amount and optional HTTPS delivery link.
2. The seller signs the invoice creation transaction and shares the checkout URL.
3. A buyer connects a wallet, approves the exact USDC amount when necessary and pays.
4. The contract transfers USDC directly to the seller and records the payer and payment time.
5. The buyer gets a public receipt and can authenticate with the paying wallet to recover the private delivery link.

The interface is in English. There is no invoice expiry or platform custody. WalletConnect is optional; browser wallets work without a Reown project.

## Run locally

Requires Node.js 24 and npm.

```sh
npm ci
npm run db:local
npm run dev
```

Open `http://127.0.0.1:5173`. The checked-in configuration points to the deployed prototype contract; a fresh clone uses its own local D1 database and will not contain the owner's local invoices. The `predev` script compiles the contract artifacts automatically. The wallet needs test MON for gas; payments also need test USDC, available from https://faucet.circle.com/ (select Monad Testnet).

To deploy your own contract, open `/setup` in a browser with a wallet and sign the deployment transaction. If no contract is configured, the interface is available but invoice creation is disabled.

Copy `.dev.vars.example` to `.dev.vars` and set `CONTRACT_ADDRESS` to the deployed public address. Restart the development server. For WalletConnect, optionally copy `.env.example` to `.env.local` and set `VITE_WALLETCONNECT_PROJECT_ID` before building.

## Publish on Cloudflare

```sh
npx wrangler login --scopes account:read user:read workers_scripts:write d1:write
npx wrangler d1 create receiptlink
```

Set `account_id` in `wrangler.jsonc` to your own Cloudflare account ID (available from `npx wrangler whoami`). Set the returned database ID in `wrangler.jsonc`. Add the deployed public `CONTRACT_ADDRESS` to its `vars`. If the account already has a Worker or database with these names, choose unused names and update the corresponding configuration and migration scripts.

```sh
npm run db:remote
npm run deploy
```

The Vite Cloudflare plugin builds the frontend and Worker together. Static assets, API and D1 use the same origin. No paid-plan upgrade is required by this project; actual resource limits depend on account configuration and traffic.

## Verify

```sh
npm test
npm run build
```

Tests cover direct settlement, duplicate payments, cancellation ownership, failed token transfers, signed authentication and replay prevention, origin checks, chain term validation, authentic contract events, payment-token validation and access to delivery links. Local tests use a mock token; deployed payments use Circle test USDC.

For manual verification, use the local frontend with two separate test wallets: create an invoice, pay it, open its receipt, retrieve its delivery link from the payer wallet, and check that the other wallet cannot retrieve that link. This two-wallet check is separate from the automated tests. Do not ask evaluators to bypass the hosted site's wallet security warning.

## Architecture and limits

The stack is React, TypeScript, wagmi, viem, Solidity and OpenZeppelin, with Cloudflare Workers for the API and static site and D1 for persistence. Monad supplies the authoritative settlement state: a payment and its receipt update occur atomically, and the server checks finalized state before issuing the delivery URL. Low-latency settlement keeps the payment-to-delivery flow responsive; the prototype does not require an indexer or custody service.

- `contracts/ReceiptLink.sol`: immutable invoice terms, direct ERC-20 transfer and on-chain receipt state/events.
- `worker/`: signed wallet authentication, D1 persistence and finalized-chain verification.
- `src/`: React frontend, wagmi/viem wallet integration and browser-signed contract deployment.
- `shared/`: canonical invoice hashes, validation, chain configuration and ABI.

Only the amount, seller, metadata hash and settlement facts are on chain. Titles and descriptions are public through the API. Delivery URLs stay in D1 and are excluded from public invoice and receipt responses. API authorization checks the finalized on-chain payer, not a client-side payment flag. Authentication currently supports externally owned accounts; contract-wallet signatures are not implemented.

A Google Drive link can be copied or shared after delivery. ReceiptLink controls disclosure of the URL, not access permissions on the external hosting service. A seller can also change or remove externally hosted files. This is a hackathon prototype, not an audited production payment service.

Network: Monad Testnet, chain ID `10143`. Payment token: Circle test USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3` (6 decimals). Test tokens have no monetary value. No private keys or seed phrases are collected.

## Build provenance and AI disclosure

ReceiptLink's application code and contract were created during the hackathon build window. Open-source libraries were used as dependencies; their attribution and licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No earlier ReceiptLink application or contract was imported.

OpenAI Codex was used to assist with implementation, contract compilation, tests, documentation and deployment. The project owner defined the product and performed wallet signing and the two-wallet payment/delivery tests. Git history starts with the first recorded source snapshot; earlier development was not tracked in Git. Commit dates are not backdated.

The R logo was created with OpenAI image generation and selected by the project owner. Its source image and generation prompt are included under `docs/branding`; the site uses a compressed WebP export and PNG/ICO favicons.

## License

ReceiptLink source is available under the [MIT License](LICENSE). Third-party dependencies retain their respective licenses.
