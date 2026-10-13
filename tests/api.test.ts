import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { handleRequest, type Env } from '../worker/index.ts';
import { receiptAbi, USDC_ADDRESS } from '../shared/chain.ts';
import type { ChainInvoice, ChainReader, ChainReceipt } from '../worker/chain.ts';

const contract = '0x3333333333333333333333333333333333333333' as Address;
const zero = '0x0000000000000000000000000000000000000000' as Address;
const emptyHash = `0x${'0'.repeat(64)}` as Hex;
const actors = [1, 2, 3].map(i => privateKeyToAccount(`0x${i.toString(16).padStart(64, '0')}`));
const privateUrl = 'https://drive.google.com/file/d/private-test-delivery/view';

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync('migrations/0001_initial.sql', 'utf8'));
  const DB = {
    prepare(sql: string) {
      let values: (string | number | null)[] = [];
      const statement = {
        bind(...args: (string | number | null)[]) { values = args; return statement; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...values), success: true }; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
      return statement;
    },
  };
  const env = { DB, ASSETS: { fetch: async () => new Response('site') }, CONTRACT_ADDRESS: contract } as unknown as Env;
  const invoices = new Map<Hex, ChainInvoice>();
  const receipts = new Map<Hex, ChainReceipt>();
  const settings = { paymentToken: USDC_ADDRESS as Address };
  const chain: ChainReader = {
    paymentToken: async () => settings.paymentToken,
    invoice: async id => invoices.get(id) || { seller: zero, amount: 0n, metadataHash: emptyHash, status: 0, payer: zero, paidAt: 0n },
    receipt: async hash => { const value = receipts.get(hash); if (!value) throw new Error('Not finalized'); return value; },
  };
  async function request(path: string, data?: unknown, cookie?: string, origin = 'https://receiptlink.test') {
    return handleRequest(new Request(`https://receiptlink.test/api${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }), env, chain);
  }
  async function login(actor: typeof actors[number]) {
    const challenge = await request('/auth/challenge', { address: actor.address });
    assert.equal(challenge.status, 200);
    const { message } = await challenge.json() as { message: string };
    const signature = await actor.signMessage({ message });
    const response = await request('/auth/verify', { message, signature });
    assert.equal(response.status, 200);
    return response.headers.get('Set-Cookie')!.split(';')[0];
  }
  return { sqlite, invoices, receipts, settings, request, login };
}

test('Authentication and private delivery are enforced by the server', async t => {
  const h = harness();
  try {
    await t.test('signatures are bound to the wallet and one-time nonce', async () => {
      const challenge = await h.request('/auth/challenge', { address: actors[0].address });
      const { message } = await challenge.json() as { message: string };
      const wrong = await actors[1].signMessage({ message });
      assert.equal((await h.request('/auth/verify', { message, signature: wrong })).status, 401);
      const signature = await actors[0].signMessage({ message });
      assert.equal((await h.request('/auth/verify', { message, signature })).status, 200);
      assert.equal((await h.request('/auth/verify', { message, signature })).status, 401);
    });
    await t.test('cross-origin mutations are rejected', async () => {
      assert.equal((await h.request('/auth/challenge', { address: actors[0].address }, undefined, 'https://attacker.test')).status, 403);
    });
    const sellerCookie = await h.login(actors[0]);
    const buyerCookie = await h.login(actors[1]);
    const otherCookie = await h.login(actors[2]);
    const prepared = await h.request('/invoices', { title: 'Digital design kit', description: 'A reusable template pack.', amount: '10', deliveryUrl: privateUrl }, sellerCookie);
    assert.equal(prepared.status, 201);
    const draft = await prepared.json() as { id: Hex; seller: Address; amount: string; metadataHash: Hex };
    const onChain: ChainInvoice = { seller: actors[0].address, amount: BigInt(draft.amount), metadataHash: draft.metadataHash, status: 1, payer: zero, paidAt: 0n };
    h.invoices.set(draft.id, onChain);

    await t.test('public invoice and seller list never return the private URL', async () => {
      const publicResponse = await h.request(`/invoices/${draft.id}`);
      assert.equal(publicResponse.status, 200);
      const publicText = await publicResponse.text();
      assert.ok(!publicText.includes(privateUrl));
      assert.ok(!publicText.includes('delivery_url'));
      const sellerText = await (await h.request('/me/invoices', undefined, sellerCookie)).text();
      assert.ok(!sellerText.includes(privateUrl));
    });
    await t.test('unpaid purchases and unauthenticated requests cannot retrieve the URL', async () => {
      assert.equal((await h.request(`/invoices/${draft.id}/delivery`)).status, 401);
      assert.equal((await h.request(`/invoices/${draft.id}/delivery`, undefined, buyerCookie)).status, 403);
    });
    await t.test('only the on-chain payer can recover delivery after payment', async () => {
      onChain.status = 2; onChain.payer = actors[1].address; onChain.paidAt = BigInt(Math.floor(Date.now() / 1000));
      assert.equal((await h.request(`/invoices/${draft.id}/delivery`, undefined, otherCookie)).status, 403);
      assert.equal((await h.request(`/invoices/${draft.id}/delivery`, undefined, sellerCookie)).status, 403);
      const authorized = await h.request(`/invoices/${draft.id}/delivery`, undefined, buyerCookie);
      assert.equal(authorized.status, 200);
      assert.deepEqual(await authorized.json(), { url: privateUrl });
      assert.equal(authorized.headers.get('Cache-Control'), 'no-store');
      const newSession = await h.login(actors[1]);
      assert.equal((await h.request(`/invoices/${draft.id}/delivery`, undefined, newSession)).status, 200);
    });
    await t.test('a payment log from an unrelated contract is not a valid proof', async () => {
      const hash = `0x${'a'.repeat(64)}` as Hex;
      const topics = encodeEventTopics({ abi: receiptAbi, eventName: 'Paid', args: { id: draft.id, payer: actors[1].address, seller: actors[0].address } });
      const data = encodeAbiParameters([{ type: 'uint256' }], [BigInt(draft.amount)]);
      h.receipts.set(hash, { status: 'success', blockNumber: 1n, logs: [{ address: actors[2].address, data, topics }] });
      assert.equal((await h.request(`/invoices/${draft.id}/confirm`, { transactionHash: hash }, buyerCookie)).status, 409);
      assert.equal(h.sqlite.prepare('SELECT payment_tx FROM invoices WHERE id = ?').get(draft.id)?.payment_tx, null);
      h.receipts.set(hash, { status: 'success', blockNumber: 1n, logs: [{ address: contract, data, topics }] });
      assert.equal((await h.request(`/invoices/${draft.id}/confirm`, { transactionHash: hash }, otherCookie)).status, 409);
      assert.equal((await h.request(`/invoices/${draft.id}/confirm`, { transactionHash: hash }, buyerCookie)).status, 200);
    });
    await t.test('mismatched on-chain terms cannot grant access', async () => {
      onChain.amount += 1n;
      assert.equal((await h.request(`/invoices/${draft.id}/delivery`, undefined, buyerCookie)).status, 409);
      onChain.amount -= 1n;
    });
    await t.test('non-HTTPS delivery links and invalid payment amounts are rejected', async () => {
      assert.equal((await h.request('/invoices', { title: 'Invalid', amount: '0', deliveryUrl: privateUrl }, sellerCookie)).status, 400);
      assert.equal((await h.request('/invoices', { title: 'Invalid', amount: '10', deliveryUrl: 'javascript:alert(1)' }, sellerCookie)).status, 400);
      assert.equal((await h.request('/invoices', { title: 'Invalid', amount: '0.0000001', deliveryUrl: privateUrl }, sellerCookie)).status, 400);
    });
    await t.test('a contract configured for another token cannot issue USDC receipts or release material', async () => {
      h.settings.paymentToken = actors[2].address;
      assert.equal((await h.request(`/invoices/${draft.id}`)).status, 503);
      assert.equal((await h.request(`/invoices/${draft.id}/delivery`, undefined, buyerCookie)).status, 503);
      assert.equal((await h.request('/invoices', { title: 'Wrong token', amount: '10' }, sellerCookie)).status, 503);
      h.settings.paymentToken = USDC_ADDRESS;
    });
    await t.test('logout invalidates the session', async () => {
      assert.equal((await h.request('/auth/logout', {}, buyerCookie)).status, 200);
      assert.equal((await h.request(`/invoices/${draft.id}/delivery`, undefined, buyerCookie)).status, 401);
    });
  } finally { h.sqlite.close(); }
});
