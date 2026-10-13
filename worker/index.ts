import { decodeEventLog, getAddress, isAddress, toHex, verifyMessage, type Address, type Hex } from 'viem';
import { createSiweMessage, parseSiweMessage } from 'viem/siwe';
import { CHAIN_ID, USDC_ADDRESS, receiptAbi, type PublicInvoice } from '../shared/chain';
import { invoiceMetadataHash, validateAmount, validateDeliveryUrl } from '../shared/invoice';
import { createChainReader, sameAddress, type ChainInvoice, type ChainReader } from './chain';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  CONTRACT_ADDRESS?: string;
  MONAD_RPC_URL?: string;
}
type InvoiceRow = {
  id: Hex; seller: Address; title: string; description: string; amount: string; metadata_hash: Hex;
  delivery_url: string | null; published: number; creation_tx: Hex | null; payment_tx: Hex | null; created_at: number;
};
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const seconds = () => Math.floor(Date.now() / 1000);
const randomToken = () => toHex(crypto.getRandomValues(new Uint8Array(32))).slice(2);
const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders },
});
const tokenHash = async (token: string) => toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
function cookieHeader(request: Request, token: string, maxAge: number) {
  return `rl_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('Content-Length') || '0') > 16_384) throw new ApiError(413, 'Request is too large.');
  const text = await request.text();
  if (text.length > 16_384) throw new ApiError(413, 'Request is too large.');
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ApiError(400, 'Invalid request.'); }
}
async function session(request: Request, env: Env): Promise<Address> {
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)rl_session=([0-9a-f]{64})(?:;|$)/)?.[1];
  if (!token) throw new ApiError(401, 'Connect your wallet and sign in to continue.');
  const row = await env.DB.prepare('SELECT address FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await tokenHash(token), seconds()).first<{ address: Address }>();
  if (!row) throw new ApiError(401, 'Your session ended. Sign in again to continue.');
  return row.address;
}
function contractAddress(env: Env): Address {
  if (!env.CONTRACT_ADDRESS || !isAddress(env.CONTRACT_ADDRESS)) throw new ApiError(503, 'Testnet payments are being set up. Please try again shortly.');
  return getAddress(env.CONTRACT_ADDRESS);
}
function requireMatch(row: InvoiceRow, chain: ChainInvoice) {
  if (chain.status === 0 || !sameAddress(row.seller, chain.seller) || row.amount !== chain.amount.toString() || row.metadata_hash.toLowerCase() !== chain.metadataHash.toLowerCase()) {
    throw new ApiError(409, 'The invoice does not match its on-chain payment terms.');
  }
}
function publicInvoice(row: InvoiceRow, chain?: ChainInvoice): PublicInvoice {
  return {
    id: row.id, seller: row.seller, title: row.title, description: row.description, amount: row.amount,
    metadataHash: row.metadata_hash, hasDelivery: !!row.delivery_url, createdAt: row.created_at,
    status: !chain || chain.status === 0 ? 'draft' : chain.status === 1 ? 'open' : chain.status === 2 ? 'paid' : 'cancelled',
    ...(chain?.status === 2 ? { payer: chain.payer, paidAt: Number(chain.paidAt), ...(row.payment_tx ? { transactionHash: row.payment_tx } : {}) } : {}),
  };
}
function invoiceId(path: string) {
  const value = path.match(/^\/api\/invoices\/(0x[0-9a-fA-F]{64})(?:\/|$)/)?.[1];
  if (!value) throw new ApiError(404, 'Invoice not found.');
  return value.toLowerCase() as Hex;
}

export async function handleRequest(request: Request, env: Env, injectedChain?: ChainReader): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!['GET', 'POST'].includes(request.method)) throw new ApiError(405, 'Method not allowed.');
    if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) throw new ApiError(403, 'Request origin is not allowed.');

    if (path === '/api/config' && request.method === 'GET') {
      return json({ chainId: CHAIN_ID, tokenAddress: USDC_ADDRESS, tokenSymbol: 'USDC', contractAddress: env.CONTRACT_ADDRESS && isAddress(env.CONTRACT_ADDRESS) ? getAddress(env.CONTRACT_ADDRESS) : null });
    }
    if (path === '/api/auth/challenge' && request.method === 'POST') {
      const input = await body(request);
      if (typeof input.address !== 'string' || !isAddress(input.address)) throw new ApiError(400, 'Connect a valid wallet.');
      const address = getAddress(input.address);
      const nonce = randomToken();
      const expiresAt = seconds() + 300;
      const message = createSiweMessage({
        address, chainId: CHAIN_ID, domain: url.host, uri: url.origin, version: '1', nonce,
        statement: 'Sign in to ReceiptLink. This does not authorize a payment or token transfer.',
        issuedAt: new Date(), expirationTime: new Date(expiresAt * 1000),
      });
      await env.DB.prepare('INSERT INTO auth_nonces (nonce, address, domain, expires_at) VALUES (?, ?, ?, ?)').bind(nonce, address, url.host, expiresAt).run();
      return json({ message });
    }
    if (path === '/api/auth/verify' && request.method === 'POST') {
      const input = await body(request);
      if (typeof input.message !== 'string' || typeof input.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(input.signature)) throw new ApiError(400, 'Invalid wallet signature.');
      const parsed = parseSiweMessage(input.message);
      if (!parsed.address || !parsed.nonce || parsed.version !== '1' || parsed.chainId !== CHAIN_ID || parsed.domain !== url.host || parsed.uri !== url.origin || !parsed.expirationTime || parsed.expirationTime.getTime() <= Date.now()) {
        throw new ApiError(401, 'This sign-in request is invalid or expired.');
      }
      const nonce = await env.DB.prepare('SELECT address, domain, expires_at, consumed_at FROM auth_nonces WHERE nonce = ?').bind(parsed.nonce).first<{ address: Address; domain: string; expires_at: number; consumed_at: number | null }>();
      if (!nonce || nonce.consumed_at !== null || nonce.expires_at <= seconds() || nonce.domain !== url.host || !sameAddress(nonce.address, parsed.address)) throw new ApiError(401, 'This sign-in request has already been used or expired.');
      if (!await verifyMessage({ address: nonce.address, message: input.message, signature: input.signature as Hex })) throw new ApiError(401, 'The wallet signature could not be verified.');
      const consumed = await env.DB.prepare('UPDATE auth_nonces SET consumed_at = ? WHERE nonce = ? AND consumed_at IS NULL AND expires_at > ?').bind(seconds(), parsed.nonce, seconds()).run();
      if (consumed.meta.changes !== 1) throw new ApiError(401, 'This sign-in request has already been used.');
      const token = randomToken();
      await env.DB.prepare('INSERT INTO sessions (token_hash, address, expires_at) VALUES (?, ?, ?)').bind(await tokenHash(token), nonce.address, seconds() + 86_400).run();
      return json({ address: nonce.address }, 200, { 'Set-Cookie': cookieHeader(request, token, 86_400) });
    }
    if (path === '/api/auth/me' && request.method === 'GET') return json({ address: await session(request, env) });
    if (path === '/api/auth/logout' && request.method === 'POST') {
      const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)rl_session=([0-9a-f]{64})(?:;|$)/)?.[1];
      if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await tokenHash(token)).run();
      return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(request, '', 0) });
    }

    const reader = async () => {
      const chain = injectedChain || createChainReader(contractAddress(env), env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz');
      if (!sameAddress(await chain.paymentToken(), USDC_ADDRESS)) throw new ApiError(503, 'The payment contract is not configured for the supported USDC token.');
      return chain;
    };
    if (path === '/api/invoices' && request.method === 'POST') {
      contractAddress(env);
      const seller = await session(request, env);
      await reader();
      const input = await body(request);
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      const description = typeof input.description === 'string' ? input.description.trim() : '';
      if (!title || title.length > 100 || description.length > 1000) throw new ApiError(400, 'Use a title of up to 100 characters and a description of up to 1,000 characters.');
      let amount: string; let deliveryUrl: string | null;
      try { amount = validateAmount(input.amount); deliveryUrl = validateDeliveryUrl(input.deliveryUrl); }
      catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Invalid invoice.'); }
      const id = ('0x' + randomToken()) as Hex;
      const metadataHash = invoiceMetadataHash(title, description, amount, seller);
      const createdAt = seconds();
      await env.DB.prepare('INSERT INTO invoices (id, seller, title, description, amount, metadata_hash, delivery_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, seller, title, description, amount, metadataHash, deliveryUrl, createdAt).run();
      return json({ id, seller, title, description, amount, metadataHash, hasDelivery: !!deliveryUrl, status: 'draft', createdAt }, 201);
    }
    if (path === '/api/me/invoices' && request.method === 'GET') {
      const seller = await session(request, env);
      const rows = await env.DB.prepare('SELECT * FROM invoices WHERE seller = ? ORDER BY created_at DESC LIMIT 20').bind(seller).all<InvoiceRow>();
      const invoices: PublicInvoice[] = [];
      const chain = await reader();
      for (const row of rows.results) {
        const onChain = await chain.invoice(row.id);
        if (onChain.status !== 0) requireMatch(row, onChain);
        invoices.push(publicInvoice(row, onChain));
      }
      return json({ invoices });
    }
    if (path.startsWith('/api/invoices/')) {
      const id = invoiceId(path);
      const row = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<InvoiceRow>();
      if (!row) throw new ApiError(404, 'Invoice not found.');
      const chain = await reader();

      if (path === `/api/invoices/${id}` && request.method === 'GET') {
        const onChain = await chain.invoice(id);
        if (onChain.status === 0) throw new ApiError(409, 'This invoice is awaiting confirmation. Please try again shortly.');
        requireMatch(row, onChain);
        return json(publicInvoice(row, onChain));
      }
      if (path === `/api/invoices/${id}/delivery` && request.method === 'GET') {
        const payer = await session(request, env);
        const onChain = await chain.invoice(id);
        requireMatch(row, onChain);
        if (onChain.status !== 2 || !sameAddress(onChain.payer, payer)) throw new ApiError(403, 'Only the wallet that paid this invoice can access the material.');
        if (!row.delivery_url) throw new ApiError(404, 'No delivery link was attached to this invoice.');
        return json({ url: row.delivery_url });
      }
      if (path === `/api/invoices/${id}/confirm` && request.method === 'POST') {
        const actor = await session(request, env);
        const input = await body(request);
        if (typeof input.transactionHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(input.transactionHash)) throw new ApiError(400, 'Enter a valid transaction hash.');
        const txHash = input.transactionHash as Hex;
        let tx;
        try { tx = await chain.receipt(txHash); }
        catch { throw new ApiError(409, 'The transaction is still being confirmed. Please try again shortly.'); }
        if (tx.status !== 'success') throw new ApiError(409, 'The transaction did not complete.');
        const contract = contractAddress(env);
        let matched = false;
        for (const log of tx.logs) {
          if (!sameAddress(log.address, contract)) continue;
          try {
            const event = decodeEventLog({ abi: receiptAbi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] });
            if (event.eventName === 'InvoiceCreated' && event.args.id.toLowerCase() === id && sameAddress(actor, row.seller) && sameAddress(event.args.seller, row.seller) && event.args.amount.toString() === row.amount && event.args.metadataHash.toLowerCase() === row.metadata_hash.toLowerCase()) {
              await env.DB.prepare('UPDATE invoices SET published = 1, creation_tx = ? WHERE id = ?').bind(txHash, id).run();
              matched = true;
            }
            if (event.eventName === 'Paid' && event.args.id.toLowerCase() === id && sameAddress(event.args.payer, actor) && sameAddress(event.args.seller, row.seller) && event.args.amount.toString() === row.amount) {
              await env.DB.prepare('UPDATE invoices SET payment_tx = ? WHERE id = ?').bind(txHash, id).run();
              matched = true;
            }
            if (event.eventName === 'InvoiceCancelled' && event.args.id.toLowerCase() === id && sameAddress(actor, row.seller)) matched = true;
          } catch { /* Other logs are not a matching payment proof. */ }
        }
        if (!matched) throw new ApiError(409, 'This transaction does not confirm your invoice.');
        const onChain = await chain.invoice(id);
        requireMatch(row, onChain);
        const updated = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<InvoiceRow>();
        return json(publicInvoice(updated!, onChain));
      }
    }
    throw new ApiError(404, 'Page not found.');
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    console.error('ReceiptLink API failure', error instanceof Error ? error.name : 'UnknownError');
    return json({ error: 'The service could not complete this request. Please try again.' }, 503);
  }
}

export default { fetch: (request: Request, env: Env) => handleRequest(request, env) };
