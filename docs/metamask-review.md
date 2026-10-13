# Request for review of a suspected false-positive website classification

URL: https://receiptlink.mongangstudio.workers.dev/
Network: Monad Testnet, chain ID 10143
Payment contract: 0xd1e42781571EE350C923ed8c024ffCfCe04b3cbf
Contract explorer: https://testnet.monadexplorer.com/address/0xd1e42781571EE350C923ed8c024ffCfCe04b3cbf
Payment token: Circle test USDC, 0x534b2f3A21130d7a60830c2Df862319e593943A3

MetaMask displays a website warning during wallet connection, before any payment or token-approval request: "This site shows signs of phishing or wallet-draining activity."

ReceiptLink is a newly published hackathon prototype for one-time payment links and optional delivery links. We are requesting review of its website classification and an explanation of the signal causing this warning. We do not yet know whether this is a false positive.

The application uses wallet discovery through wagmi, signed wallet login with one-time SIWE challenges, and a payment contract with immutable invoice amounts and recipients. It never requests seed phrases or private keys. Token approvals specify the invoice amount, not an unlimited allowance. Payments transfer test USDC directly from the payer to the invoice seller; the contract has no custody or administration function to withdraw users' funds.

The deployed runtime was compared with the locally compiled ReceiptLink contract, accounting for its immutable constructor value. The configured payment token was separately checked on Monad Testnet. Automated checks cover settlement, replay prevention, ownership and private delivery access. These checks are not a third-party security audit, and the live two-wallet payment test is still pending.

The published MetaMask eth-phishing-detect configuration was checked during diagnosis: the exact hostname and its parent domains were not found in its list arrays. This does not exclude fuzzy matching, other security providers, cached data or additional risk signals.

Please review the classification for this URL. Attach the screenshot of the warning when submitting this request through official MetaMask Support.
