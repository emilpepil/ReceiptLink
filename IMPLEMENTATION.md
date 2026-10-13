# ReceiptLink MVP

- Deadline: October 14, 2026 at 03:59 UTC / 07:59 Asia/Tbilisi (October 13, 23:59 Eastern Daylight Time).
- Network: Monad Testnet, chain ID 10143.
- UI language: English.
- Hosting: Cloudflare Workers Static Assets and Workers API; D1 database.
- Payment asset: Circle testnet USDC (`0x534b2f3A21130d7a60830c2Df862319e593943A3`). Test tokens have no financial value.
- Wallets: discovered browser wallets first; WalletConnect when a public Reown Project ID is available.
- Invoice: one payment per invoice, immutable seller/amount/token/metadata, no payment deadline.
- Settlement: direct buyer-to-seller transfer with an atomic on-chain payment receipt.
- Delivery: optional HTTPS URL, stored privately off-chain and released only to the authenticated payer after finalized settlement.
- Public receipts never include the delivery URL.
- No private keys or seed phrases are collected or stored. Contract deployment is signed in the user's wallet.

## Milestones

1. Contract compilation and adversarial settlement tests.
2. English UI: create, invoice list, checkout, public receipt, private delivery.
3. Workers authentication, D1 persistence and independent chain verification.
4. Browser-signed contract deployment and Cloudflare publication.
5. Testnet validation with two wallets and submission materials.

## Publication dependencies

- Cloudflare browser OAuth login, existing user account confirmed.
- Remote D1 ID after creation.
- Wallet with testnet MON for contract deployment; testnet USDC and MON for a buyer.
- Optional Reown Project ID (not yet created).
