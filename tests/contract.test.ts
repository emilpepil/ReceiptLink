import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, defineChain, erc20Abi, keccak256, toBytes, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { receiptAbi } from '../shared/chain.ts';

test('ReceiptLink enforces settlement and invoice ownership', async t => {
  const provider = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 3 }, chain: { chainId: 31337, hardfork: 'shanghai' } });
  const transport = custom(provider as Parameters<typeof custom>[0]);
  const chain = defineChain({ id: 31337, name: 'Local', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['http://localhost'] } } });
  const accounts = Object.values(provider.getInitialAccounts()).map(value => privateKeyToAccount(value.secretKey as Hex));
  const [seller, buyer, stranger] = accounts.map(account => createWalletClient({ account, chain, transport }));
  const client = createPublicClient({ chain, transport });
  const tokenArtifact = JSON.parse(fs.readFileSync('artifacts/MockUSDC.json', 'utf8'));
  const artifact = JSON.parse(fs.readFileSync('artifacts/ReceiptLink.json', 'utf8'));
  async function mined(hash: Hex) {
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success');
    return receipt;
  }
  async function expectRevert(action: () => Promise<Hex>) {
    let hash: Hex;
    try { hash = await action(); }
    catch { return; }
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'reverted', 'Expected a reverted transaction');
  }
  try {
    const token = (await mined(await seller.deployContract({ abi: tokenArtifact.abi, bytecode: tokenArtifact.bytecode }))).contractAddress!;
    const contract = (await mined(await seller.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [token] }))).contractAddress!;
    const metadataHash = keccak256(toBytes('Immutable invoice terms'));
    let counter = 0;
    async function create(amount = 10_000_000n) {
      const id = keccak256(toBytes(`invoice-${++counter}`));
      await mined(await seller.writeContract({ address: contract, abi: receiptAbi, functionName: 'createInvoice', args: [id, amount, metadataHash] }));
      return id;
    }
    async function read(id: Hex) { return client.readContract({ address: contract, abi: receiptAbi, functionName: 'getInvoice', args: [id] }); }
    async function balance(address: Address) { return client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address] }); }
    await mined(await seller.writeContract({ address: token, abi: tokenArtifact.abi, functionName: 'mint', args: [buyer.account.address, 100_000_000n] }));

    await t.test('creation fixes recipient, amount and metadata; duplicate IDs cannot overwrite terms', async () => {
      const id = await create();
      await expectRevert(() => stranger.writeContract({ address: contract, abi: receiptAbi, functionName: 'createInvoice', args: [id, 1n, metadataHash] }));
      const value = await read(id);
      assert.equal(value.seller.toLowerCase(), seller.account.address.toLowerCase());
      assert.equal(value.amount, 10_000_000n);
      assert.equal(value.metadataHash, metadataHash);
      assert.equal(value.status, 1);
    });
    await t.test('failed token transfer rolls back the paid state', async () => {
      const id = await create();
      await expectRevert(() => buyer.writeContract({ address: contract, abi: receiptAbi, functionName: 'pay', args: [id] }));
      const value = await read(id);
      assert.equal(value.status, 1);
      assert.equal(value.paidAt, 0n);
      assert.equal(value.payer, '0x0000000000000000000000000000000000000000');
    });
    await t.test('successful payment transfers the exact amount directly and records the actual payer', async () => {
      const id = await create();
      const sellerBefore = await balance(seller.account.address);
      const buyerBefore = await balance(buyer.account.address);
      await mined(await buyer.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [contract, 10_000_000n] }));
      await mined(await buyer.writeContract({ address: contract, abi: receiptAbi, functionName: 'pay', args: [id] }));
      const value = await read(id);
      assert.equal(value.status, 2);
      assert.equal(value.payer.toLowerCase(), buyer.account.address.toLowerCase());
      assert.ok(value.paidAt > 0n);
      assert.equal(await balance(seller.account.address), sellerBefore + 10_000_000n);
      assert.equal(await balance(buyer.account.address), buyerBefore - 10_000_000n);
      assert.equal(await balance(contract), 0n);
      await mined(await buyer.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [contract, 10_000_000n] }));
      await expectRevert(() => buyer.writeContract({ address: contract, abi: receiptAbi, functionName: 'pay', args: [id] }));
      assert.equal(await balance(seller.account.address), sellerBefore + 10_000_000n);
      await expectRevert(() => seller.writeContract({ address: contract, abi: receiptAbi, functionName: 'cancelInvoice', args: [id] }));
      assert.equal((await read(id)).status, 2);
    });
    await t.test('only the seller can cancel; cancelled invoices cannot be paid', async () => {
      const id = await create();
      await expectRevert(() => stranger.writeContract({ address: contract, abi: receiptAbi, functionName: 'cancelInvoice', args: [id] }));
      assert.equal((await read(id)).status, 1);
      await mined(await seller.writeContract({ address: contract, abi: receiptAbi, functionName: 'cancelInvoice', args: [id] }));
      assert.equal((await read(id)).status, 3);
      await expectRevert(() => buyer.writeContract({ address: contract, abi: receiptAbi, functionName: 'pay', args: [id] }));
    });
    await t.test('nonexistent and zero-amount invoices are rejected', async () => {
      const id = keccak256(toBytes('unknown'));
      await expectRevert(() => buyer.writeContract({ address: contract, abi: receiptAbi, functionName: 'pay', args: [id] }));
      await expectRevert(() => seller.writeContract({ address: contract, abi: receiptAbi, functionName: 'createInvoice', args: [id, 0n, metadataHash] }));
      assert.equal((await read(id)).status, 0);
    });
  } finally { await provider.disconnect(); }
});
