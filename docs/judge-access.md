# Judge access instructions

Hosted app: https://receiptlink.emilpepil.workers.dev

Source: https://github.com/emilpepil/ReceiptLink

## Current limitation

The project owner observed a MetaMask security warning on the current hosted URL and on the previous Cloudflare URL. The cause remains unknown. Do not bypass the warning, disable wallet protection or connect a wallet with real assets. MetaMask Support has been contacted; no clearance is claimed.

The submitted demo was recorded locally with real Monad Testnet transactions. The local two-wallet flow passed invoice creation, payment, receipt display, payer-only delivery retrieval, opening the sample file and rejection of delivery access from the seller wallet. The public wallet payment flow remains unverified.

## Reproduce locally

Use Node.js 24 and follow the README:

```sh
git clone https://github.com/emilpepil/ReceiptLink.git
cd ReceiptLink
npm ci
npm run db:local
npm run dev
```

Open http://127.0.0.1:5173 in a browser with a test wallet. No email account, password or private key submission is required. A fresh local database does not contain the owner's earlier test invoices.

If a wallet security warning also appears locally, stop and evaluate through the demo, source code and automated tests instead.

## Test the payment and delivery flow

1. Prepare two separate test wallets, seller and buyer. Both need test MON for network fees; the buyer also needs test USDC.
2. Connect the seller wallet and choose Create invoice.
3. Add a title, set the amount to 0.1 test USDC and paste an HTTPS delivery URL to a non-sensitive sample file. Ensure the external file's permissions allow it to be opened by its recipient.
4. Sign the login message and confirm invoice creation on Monad Testnet.
5. Copy the payment link and open it with the buyer wallet in another browser profile on the same computer.
6. Sign in, approve the invoice amount in USDC and confirm payment.
7. Inspect the paid receipt, then choose Get delivery link and Open material.
8. Open the same receipt with the seller wallet and request delivery access. The service should reject the request because this wallet did not pay.

ReceiptLink controls disclosure of the URL. The seller remains responsible for the external file and its availability; a retrieved URL can be shared by its recipient.

## Network and payment proof

- Network: Monad Testnet, chain ID 10143.
- MON faucet: https://faucet.monad.xyz
- USDC faucet: https://faucet.circle.com (select Monad Testnet).
- Test USDC: `0x534b2f3A21130d7a60830c2Df862319e593943A3`.
- ReceiptLink contract: `0xd1e42781571EE350C923ed8c024ffCfCe04b3cbf`.
- Independently verified 0.1 test USDC payment: https://testnet.monadexplorer.com/tx/0x28614cab2a8cd8bac3186b39a705659b1d8a7c4f8bcdcde5f826079c77213dd5

Run `npm test` for automated API and contract checks. These tests and the manual demo are not a third-party security audit.
