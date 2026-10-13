import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAccount, useConnect, useDisconnect, usePublicClient, useSignMessage, useSwitchChain, useWalletClient, useWriteContract } from 'wagmi';
import { erc20Abi, formatUnits, getAddress, type Address, type Hex } from 'viem';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, Copy, ExternalLink, FileText, Link2, LoaderCircle, Plus, ReceiptText, ShieldCheck, Wallet, X } from 'lucide-react';
import { CHAIN_ID, monadTestnet, receiptAbi, type AppConfig, type PublicInvoice } from '../shared/chain';
import { api, ApiError } from './api';

const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const invoiceLabel = (value: string) => `RL-${value.slice(2, 10).toUpperCase()}`;
const dollars = (amount: string) => Number(formatUnits(BigInt(amount), 6)).toLocaleString('en-US', { maximumFractionDigits: 6 });
const statusLabel = (value: PublicInvoice['status']) => ({ draft: 'Draft', open: 'Awaiting payment', paid: 'Paid', cancelled: 'Cancelled' })[value];
const explorer = (kind: 'tx' | 'address', value: string) => `${monadTestnet.blockExplorers!.default.url}/${kind}/${value}`;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function friendlyError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  const text = error instanceof Error ? error.message : String(error);
  if (/rejected|denied|cancelled by user/i.test(text)) return 'Request cancelled. Nothing has been confirmed.';
  if (/insufficient funds/i.test(text)) return 'Your wallet needs more testnet funds. USDC pays the invoice; MON covers the network fee.';
  if (/InvoiceNotOpen|already paid/i.test(text)) return 'This invoice is no longer open. Refresh to check its status.';
  if (/chain|network/i.test(text)) return 'Switch your wallet to Monad Testnet and try again.';
  return 'We could not complete this step. Check your wallet and try again.';
}

export default function App() {
  const account = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { data: walletClient } = useWalletClient();
  const [path, setPath] = useState(window.location.pathname);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [authAddress, setAuthAddress] = useState<Address | null>(null);
  const [invoices, setInvoices] = useState<PublicInvoice[]>([]);
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [walletPicker, setWalletPicker] = useState(false);
  const [copied, setCopied] = useState('');
  const [deliveryUrl, setDeliveryUrl] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState('all');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('10');
  const [materialUrl, setMaterialUrl] = useState('');
  const [deployedContract, setDeployedContract] = useState<Address | null>(null);

  const navigate = useCallback((next: string) => {
    window.history.pushState({}, '', next); setPath(next); setError(''); setNotice(''); setDeliveryUrl('');
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const pop = () => { setPath(window.location.pathname); setError(''); setDeliveryUrl(''); };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => { api<AppConfig>('/config').then(setConfig).catch(e => setError(friendlyError(e))); }, []);
  useEffect(() => { api<{ address: Address }>('/auth/me').then(r => setAuthAddress(r.address)).catch(() => {}); }, []);
  useEffect(() => {
    if (!walletPicker) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setWalletPicker(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [walletPicker]);
  useEffect(() => {
    let cancelled = false;
    const id = path.match(/^\/(?:i|r)\/(0x[0-9a-fA-F]{64})$/)?.[1];
    if (id) {
      setLoading(true); setInvoice(null); setDeliveryUrl('');
      api<PublicInvoice>(`/invoices/${id}`).then(value => { if (!cancelled) setInvoice(value); }).catch(e => { if (!cancelled) setError(friendlyError(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    } else if (path === '/' && authAddress && account.address && getAddress(authAddress) === getAddress(account.address) && config?.contractAddress) {
      setLoading(true);
      api<{ invoices: PublicInvoice[] }>('/me/invoices').then(value => { if (!cancelled) setInvoices(value.invoices); }).catch(e => { if (!cancelled) setError(friendlyError(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    }
    return () => { cancelled = true; };
  }, [path, authAddress, account.address, config?.contractAddress, refresh]);

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopied(label); setTimeout(() => setCopied(''), 2000); }
    catch { setNotice(value); }
  }
  async function ensureAuth() {
    const address = account.address;
    if (!address) { setWalletPicker(true); throw new ApiError(401, 'Connect your wallet to continue.'); }
    try {
      const existing = await api<{ address: Address }>('/auth/me');
      if (getAddress(existing.address) === getAddress(address)) { setAuthAddress(existing.address); return address; }
    } catch { /* A new signature is required when there is no matching session. */ }
    setBusy('Sign in with your wallet');
    const { message } = await api<{ message: string }>('/auth/challenge', { address });
    const signature = await signMessageAsync({ message, account: address });
    const verified = await api<{ address: Address }>('/auth/verify', { message, signature });
    setAuthAddress(verified.address);
    return address;
  }
  async function ensureNetwork() {
    if (!account.address) { setWalletPicker(true); throw new ApiError(401, 'Connect your wallet to continue.'); }
    if (account.chainId !== CHAIN_ID) {
      setBusy('Switch to Monad Testnet');
      await switchChainAsync({ chainId: CHAIN_ID });
    }
  }
  async function confirmTransaction(id: Hex, transactionHash: Hex) {
    sessionStorage.setItem(`receiptlink:${id}`, transactionHash);
    setBusy('Waiting for confirmation');
    await publicClient!.waitForTransactionReceipt({ hash: transactionHash });
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const confirmed = await api<PublicInvoice>(`/invoices/${id}/confirm`, { transactionHash });
        sessionStorage.removeItem(`receiptlink:${id}`);
        return confirmed;
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 409 || attempt === 14) throw e;
        await wait(1500);
      }
    }
    throw new Error('Confirmation timed out.');
  }
  async function finishInvoice(value: PublicInvoice) {
    await ensureNetwork();
    const address = await ensureAuth();
    if (!config?.contractAddress || !publicClient) throw new ApiError(503, 'Testnet payments are being set up.');
    const pending = sessionStorage.getItem(`receiptlink:${value.id}`) as Hex | null;
    if (pending) { await confirmTransaction(value.id, pending); navigate(`/i/${value.id}`); return; }
    setBusy('Confirm invoice creation in your wallet');
    const transactionHash = await writeContractAsync({
      account: address, address: config.contractAddress, abi: receiptAbi, functionName: 'createInvoice',
      args: [value.id, BigInt(value.amount), value.metadataHash], chainId: CHAIN_ID,
    });
    await confirmTransaction(value.id, transactionHash);
    navigate(`/i/${value.id}`);
  }
  async function createInvoice(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setError(''); setNotice(''); setBusy('Preparing your invoice');
    try {
      await ensureNetwork(); await ensureAuth();
      const value = await api<PublicInvoice>('/invoices', { title, description, amount, deliveryUrl: materialUrl });
      await finishInvoice(value);
      setTitle(''); setDescription(''); setAmount('10'); setMaterialUrl('');
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(''); }
  }
  async function payInvoice() {
    if (!invoice || !config?.contractAddress || !publicClient || busy) return;
    setError(''); setNotice(''); setBusy('Preparing your payment');
    try {
      await ensureNetwork(); const payer = await ensureAuth();
      const pending = sessionStorage.getItem(`receiptlink:${invoice.id}`) as Hex | null;
      if (pending) {
        const confirmed = await confirmTransaction(invoice.id, pending);
        setInvoice(confirmed); navigate(`/r/${invoice.id}`); return;
      }
      const required = BigInt(invoice.amount);
      const balance = await publicClient.readContract({ address: config.tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [payer] });
      if (balance < required) throw new ApiError(400, 'You need more testnet USDC to pay this invoice.');
      const allowance = await publicClient.readContract({ address: config.tokenAddress, abi: erc20Abi, functionName: 'allowance', args: [payer, config.contractAddress] });
      if (allowance < required) {
        setBusy('Approve this USDC amount in your wallet');
        const approval = await writeContractAsync({ account: payer, address: config.tokenAddress, abi: erc20Abi, functionName: 'approve', args: [config.contractAddress, required], chainId: CHAIN_ID });
        await publicClient.waitForTransactionReceipt({ hash: approval });
      }
      setBusy('Confirm payment in your wallet');
      const transactionHash = await writeContractAsync({ account: payer, address: config.contractAddress, abi: receiptAbi, functionName: 'pay', args: [invoice.id], chainId: CHAIN_ID });
      const confirmed = await confirmTransaction(invoice.id, transactionHash);
      setInvoice(confirmed); navigate(`/r/${invoice.id}`);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(''); }
  }
  async function getDelivery() {
    if (!invoice || busy) return;
    setError(''); setBusy('Checking your purchase');
    try {
      await ensureAuth();
      const delivery = await api<{ url: string }>(`/invoices/${invoice.id}/delivery`);
      setDeliveryUrl(delivery.url);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(''); }
  }
  async function cancelInvoice() {
    if (!invoice || !config?.contractAddress || busy) return;
    setError(''); setBusy('Cancel this invoice in your wallet');
    try {
      await ensureNetwork(); const address = await ensureAuth();
      const hash = await writeContractAsync({ account: address, address: config.contractAddress, abi: receiptAbi, functionName: 'cancelInvoice', args: [invoice.id], chainId: CHAIN_ID });
      setInvoice(await confirmTransaction(invoice.id, hash));
      setRefresh(value => value + 1);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(''); }
  }
  async function signIn() {
    setError('');
    try { await ensureAuth(); setRefresh(value => value + 1); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(''); }
  }
  async function deployContract() {
    setError(''); setBusy('Preparing testnet deployment');
    try {
      await ensureNetwork();
      if (!walletClient || !account.address || !publicClient || !config) throw new Error('Connect a wallet.');
      const tokenCode = await publicClient.getCode({ address: config.tokenAddress });
      if (!tokenCode || tokenCode === '0x') throw new ApiError(503, 'The configured testnet USDC contract is unavailable.');
      const artifact = await import('../artifacts/ReceiptLink.json');
      setBusy('Sign the deployment in your wallet');
      const hash = await walletClient.deployContract({ account: account.address, chain: monadTestnet, abi: artifact.abi, bytecode: artifact.bytecode as Hex, args: [config.tokenAddress] });
      setBusy('Waiting for deployment');
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Deployment failed.');
      setDeployedContract(receipt.contractAddress);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(''); }
  }

  const connectedSession = !!(account.address && authAddress && getAddress(account.address) === getAddress(authAddress));
  const shownInvoices = invoices.filter(value => filter === 'all' || value.status === filter);
  const received = invoices.filter(value => value.status === 'paid').reduce((total, value) => total + BigInt(value.amount), 0n);
  const isReceipt = path.startsWith('/r/');
  const isInvoicePage = path.startsWith('/i/') || isReceipt;

  function walletButton() {
    return account.address ? <button className="button wallet-button" disabled={!!busy} onClick={() => { disconnect(); setAuthAddress(null); setInvoices([]); api('/auth/logout', {}).catch(() => {}); }}><span className="wallet-dot"/>{shortAddress(account.address)}<ChevronDown size={14}/></button>
      : <button className="button button-dark" onClick={() => setWalletPicker(true)}><Wallet size={16}/>Connect wallet</button>;
  }
  function receiptDetails(value: PublicInvoice) {
    return <dl className="detail-list"><div><dt>Invoice</dt><dd className="mono">{invoiceLabel(value.id)}</dd></div><div><dt>Seller</dt><dd><a href={explorer('address', value.seller)} target="_blank" rel="noreferrer">{shortAddress(value.seller)}<ExternalLink size={12}/></a></dd></div><div><dt>Network</dt><dd>Monad Testnet</dd></div><div><dt>Payment token</dt><dd>USDC</dd></div>{value.payer && <div><dt>Paid by</dt><dd className="mono">{shortAddress(value.payer)}</dd></div>}{value.paidAt && <div><dt>Paid on</dt><dd>{new Date(value.paidAt * 1000).toLocaleString('en-US')}</dd></div>}{value.transactionHash && <div><dt>Transaction</dt><dd><a href={explorer('tx', value.transactionHash)} target="_blank" rel="noreferrer">View on explorer<ExternalLink size={12}/></a></dd></div>}</dl>;
  }

  return <div className="app-shell">
    <header className="site-header"><div className="header-inner">
      <button className="brand" onClick={() => navigate('/')} aria-label="ReceiptLink home"><span className="brand-mark"><ReceiptText size={22}/></span>ReceiptLink<span className="beta">BETA</span></button>
      <nav className="top-nav" aria-label="Main navigation"><button className={path === '/' ? 'active' : ''} onClick={() => navigate('/')}>Overview</button><button className={path === '/new' ? 'active' : ''} onClick={() => navigate('/new')}>Create invoice</button></nav>
      <div className="header-actions"><span className="network-label"><span/>Monad Testnet</span>{walletButton()}</div>
    </div></header>

    <main className="main-content">
      {error && <div className="alert alert-error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
      {notice && <div className="alert" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16}/></button></div>}
      {busy && <div className="activity" role="status"><LoaderCircle className="spin" size={16}/>{busy}</div>}

      {path === '/' && <>
        <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/>A SMALLER WAY TO GET PAID</div><h1>Your work.<br/>One link.<br/><span>Payment, proven.</span></h1><p>Create an invoice, get paid in USDC, and deliver your work. Every payment leaves a verifiable receipt on Monad.</p><div className="hero-actions"><button className="button button-dark button-large" onClick={() => navigate('/new')}>Create your first invoice<ArrowRight size={17}/></button><span>No payment deadline.<br/>No funds held by us.</span></div></div>
          <div className="hero-visual" aria-label="Example of an invoice payment receipt"><div className="receipt-shadow"/><div className="sample-receipt"><div className="sample-top"><ReceiptText size={21}/><span>EXAMPLE RECEIPT</span><CheckCheck size={20}/></div><span className="status-pill paid"><Check size={13}/>Payment received</span><div className="sample-amount">250<span>USDC</span></div><h3>Brand identity package</h3><p>Invoice · RL-SAMPLE</p><div className="sample-divider"/><div className="sample-row"><span>Network</span><strong>Monad Testnet</strong></div><div className="sample-row"><span>Proof of payment</span><strong><ShieldCheck size={14}/>On-chain</strong></div><div className="sample-delivery"><ArrowDownToLine size={16}/><span>Work delivered.<br/><strong>Receipt stays verifiable.</strong></span><ArrowRight size={16}/></div></div><div className="proof-chip"><ShieldCheck size={18}/><span>Proof, not a screenshot.</span></div></div>
        </section>
        <div className="how-it-works"><div><span>01</span><strong>Create a payment link</strong><p>Add your amount and a delivery link.</p></div><div><span>02</span><strong>Your client pays</strong><p>USDC goes straight to your wallet.</p></div><div><span>03</span><strong>Deliver with a receipt</strong><p>Paid clients unlock their material.</p></div></div>

        <section className="invoice-section"><div className="section-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>Recent invoices</h2></div><button className="button" onClick={() => navigate('/new')}><Plus size={16}/>New invoice</button></div>
          {!connectedSession ? <div className="empty-state"><span className="empty-icon"><FileText size={26}/></span><h3>A clean start for your next project.</h3><p>Sign in with your wallet to see your invoices and payment receipts.</p><button className="button button-dark" disabled={!!busy} onClick={account.address ? signIn : () => setWalletPicker(true)}>{account.address ? 'Sign in to view invoices' : 'Connect wallet'}<ArrowRight size={16}/></button></div> : <>
            <div className="workspace-summary"><span>{invoices.length} recent invoices</span><span>{dollars(received.toString())} USDC received in this list</span></div>
            <div className="filter-row" aria-label="Filter invoices">{[['all', 'All invoices'], ['open', 'Awaiting payment'], ['paid', 'Paid'], ['draft', 'Drafts']].map(([value, label]) => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
            {loading ? <div className="loading-state"><LoaderCircle className="spin" size={20}/>Loading your invoices…</div> : shownInvoices.length ? <div className="invoice-table"><div className="table-header"><span>Invoice / project</span><span>Amount</span><span>Status</span><span>Action</span></div>{shownInvoices.map(value => <div className="invoice-table-row" key={value.id}><div><strong>{value.title}</strong><span className="mono">{invoiceLabel(value.id)}</span></div><div>{dollars(value.amount)} <span className="muted">USDC</span></div><div><span className={`status-pill ${value.status}`}>{statusLabel(value.status)}</span></div><div><button className="text-button" disabled={!!busy} onClick={value.status === 'draft' ? async () => { setError(''); try { await finishInvoice(value); } catch (e) { setError(friendlyError(e)); } finally { setBusy(''); } } : () => navigate(`/${value.status === 'paid' ? 'r' : 'i'}/${value.id}`)}>{value.status === 'draft' ? 'Finish creating' : 'View'}<ArrowRight size={14}/></button></div></div>)}</div> : <div className="empty-state compact"><h3>No invoices here yet.</h3><p>Create a link for your next project.</p></div>}
          </>}
        </section>
      </>}

      {path === '/new' && <>
        <button className="back-link" onClick={() => navigate('/')}><ArrowLeft size={15}/>Back to overview</button>
        <div className="page-heading"><span className="eyebrow">GET PAID FOR YOUR WORK</span><h1>Create an invoice.</h1><p>A clear amount. A shareable link. A receipt your client can verify.</p></div>
        <div className="create-grid"><form className="panel form-panel" onSubmit={createInvoice}><div className="panel-heading"><h2>Invoice details</h2><span className="subtle-tag">USDC · Monad</span></div>
          <label htmlFor="title">Title<span>What is your client paying for?</span></label><input id="title" required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Brand identity package" disabled={!!busy}/>
          <label htmlFor="description">Description<span>Optional</span></label><textarea id="description" maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} placeholder="A short description of the work or product." disabled={!!busy}/>
          <label htmlFor="amount">Amount</label><div className="amount-input"><span>$</span><input id="amount" type="number" required min="0.000001" max="99999999" step="0.000001" value={amount} onChange={e => setAmount(e.target.value)} disabled={!!busy}/><strong>USDC</strong></div>
          <div className="form-separator"/><label htmlFor="material">Delivery link<span>Optional · shown only after payment</span></label><div className="icon-input"><Link2 size={16}/><input id="material" type="url" maxLength={2048} value={materialUrl} onChange={e => setMaterialUrl(e.target.value)} placeholder="https://drive.google.com/…" disabled={!!busy}/></div><p className="field-note">Paste a link your client can open and download. Keep file permissions set for people with the link.</p>
          <div className="form-note"><ShieldCheck size={17}/><span>The amount and recipient are fixed when you create the invoice. Your delivery link stays private.</span></div>
          <button className="button button-dark button-full" type="submit" disabled={!!busy || !config?.contractAddress}>{busy ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>}Create payment link</button>{!config?.contractAddress && <p className="field-note setup-note">Testnet payments are being set up. <button type="button" className="text-button" onClick={() => navigate('/setup')}>Set up the prototype<ArrowRight size={12}/></button></p>}
        </form><aside className="preview-column"><span className="eyebrow">CLIENT PREVIEW</span><div className="panel invoice-preview"><div className="preview-brand"><span className="brand-mark small"><ReceiptText size={17}/></span>ReceiptLink</div><span className="status-pill open">Awaiting payment</span><div className="checkout-amount">{amount && Number(amount) > 0 ? Number(amount).toLocaleString('en-US', { maximumFractionDigits: 6 }) : '0'}<span>USDC</span></div><h2>{title || 'Your next project'}</h2><p className="invoice-description">{description || 'Your invoice description will appear here.'}</p><dl className="detail-list"><div><dt>Pay to</dt><dd>{account.address ? shortAddress(account.address) : 'Your connected wallet'}</dd></div><div><dt>Network</dt><dd>Monad Testnet</dd></div><div><dt>After payment</dt><dd>{materialUrl ? 'Receipt + delivery link' : 'Verifiable receipt'}</dd></div></dl><div className="preview-pay">Pay invoice<ArrowRight size={16}/></div></div><p className="preview-caption"><ShieldCheck size={14}/>Payment goes directly to your wallet.</p></aside></div>
      </>}

      {isInvoicePage && <>
        <button className="back-link" onClick={() => navigate('/')}><ArrowLeft size={15}/>ReceiptLink</button>
        {loading ? <div className="loading-state"><LoaderCircle className="spin" size={22}/>Loading invoice…</div> : invoice && <div className="checkout-layout"><section className="panel checkout-card"><div className="checkout-heading"><span className="preview-brand"><span className="brand-mark small"><ReceiptText size={17}/></span>{isReceipt ? 'Payment receipt' : 'Payment request'}</span><span className={`status-pill ${invoice.status}`}>{invoice.status === 'paid' && <Check size={13}/>} {statusLabel(invoice.status)}</span></div>
          <div className="checkout-amount">{dollars(invoice.amount)}<span>USDC</span></div><h1>{invoice.title}</h1>{invoice.description && <p className="invoice-description">{invoice.description}</p>}{receiptDetails(invoice)}
          {invoice.status === 'open' ? <><button className="button button-dark button-full" disabled={!!busy || !config?.contractAddress} onClick={account.address ? payInvoice : () => setWalletPicker(true)}>{busy ? <LoaderCircle className="spin" size={16}/> : <Wallet size={16}/>} {account.address ? account.chainId !== CHAIN_ID ? 'Switch network and pay' : `Pay ${dollars(invoice.amount)} USDC` : 'Connect wallet to pay'}<ArrowRight size={16}/></button><p className="field-note centered">Your wallet may ask to approve this USDC amount first.<br/>Network fees are paid separately in MON.</p>{account.address && getAddress(account.address) === getAddress(invoice.seller) && <button className="text-button muted" disabled={!!busy} onClick={cancelInvoice}>Cancel unpaid invoice</button>}</> : invoice.status === 'paid' ? <div className="paid-message"><ShieldCheck size={19}/><div><strong>Payment verified on Monad.</strong><p>This receipt records the payment, independently of the delivery link.</p></div></div> : <div className="alert">This invoice was cancelled and cannot be paid.</div>}
          <div className="checkout-share"><button className="text-button" onClick={() => copy(`${window.location.origin}/${invoice.status === 'paid' ? 'r' : 'i'}/${invoice.id}`, 'invoice')}><Copy size={14}/>{copied === 'invoice' ? 'Link copied' : invoice.status === 'paid' ? 'Copy receipt link' : 'Copy payment link'}</button><button className="text-button" onClick={() => setRefresh(value => value + 1)}>Refresh status</button></div>
        </section><aside className="checkout-side">
          {invoice.status === 'paid' && invoice.hasDelivery ? <div className="panel delivery-panel"><div className="delivery-icon"><ArrowDownToLine size={25}/></div><span className="eyebrow">YOUR MATERIAL</span><h2>Ready when you are.</h2><p>Connect the wallet that paid this invoice to access your delivery link.</p>{deliveryUrl ? <><a className="button button-dark button-full" href={deliveryUrl} target="_blank" rel="noreferrer">Open material<ExternalLink size={16}/></a><p className="field-note">{new URL(deliveryUrl).hostname}</p></> : <button className="button button-dark button-full" disabled={!!busy} onClick={account.address ? getDelivery : () => setWalletPicker(true)}>Get delivery link<ArrowRight size={16}/></button>}</div> : <div className="panel assurance-panel"><ShieldCheck size={24}/><h3>{invoice.hasDelivery ? 'Pay. Unlock. Keep the proof.' : 'A receipt you can verify.'}</h3><p>{invoice.hasDelivery ? 'Your delivery link becomes available after the payment is confirmed. Return with the same wallet to access it again.' : 'Your payment is recorded on Monad and linked to this invoice.'}</p><div className="small-rule"/><p className="field-note">ReceiptLink confirms payment. The seller remains responsible for the material and its availability.</p></div>}
          <div className="testnet-note"><span className="network-label"><span/>Monad Testnet</span><p>This prototype uses testnet tokens with no monetary value.</p><a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">Get testnet MON<ExternalLink size={12}/></a><a href="https://faucet.circle.com" target="_blank" rel="noreferrer">Get testnet USDC<ExternalLink size={12}/></a></div>
        </aside></div>}
      </>}

      {path === '/setup' && <section className="setup-page"><button className="back-link" onClick={() => navigate('/')}><ArrowLeft size={15}/>Back to ReceiptLink</button><div className="page-heading"><span className="eyebrow">PROTOTYPE SETUP</span><h1>Deploy with your wallet.</h1><p>Deploy the ReceiptLink contract to Monad Testnet. Your private key stays in your wallet.</p></div><div className="panel"><h2>Payment contract</h2><dl className="detail-list"><div><dt>Network</dt><dd>Monad Testnet · {CHAIN_ID}</dd></div><div><dt>Token</dt><dd className="mono">{config ? shortAddress(config.tokenAddress) : 'Loading…'}</dd></div><div><dt>Contract</dt><dd>{config?.contractAddress ? shortAddress(config.contractAddress) : 'Not configured'}</dd></div></dl>{deployedContract ? <><div className="paid-message"><CheckCheck size={22}/><div><strong>Contract deployed.</strong><p>Add this address as CONTRACT_ADDRESS in the Worker environment, then restart or redeploy.</p></div></div><div className="code-box">{deployedContract}</div><button className="button" onClick={() => copy(deployedContract, 'contract')}><Copy size={15}/>{copied === 'contract' ? 'Copied' : 'Copy address'}</button><a className="button" href={explorer('address', deployedContract)} target="_blank" rel="noreferrer">View contract<ExternalLink size={15}/></a></> : <button className="button button-dark" disabled={!!busy || !config} onClick={account.address ? deployContract : () => setWalletPicker(true)}>{busy ? <LoaderCircle className="spin" size={16}/> : <Wallet size={16}/>} {account.address ? 'Deploy to Monad Testnet' : 'Connect deployment wallet'}</button>}</div></section>}
      {!['/', '/new', '/setup'].includes(path) && !isInvoicePage && <div className="empty-state"><h1>That link does not exist.</h1><button className="button button-dark" onClick={() => navigate('/')}>Back to ReceiptLink</button></div>}
    </main>
    <footer className="site-footer"><div><span className="footer-brand"><ReceiptText size={16}/>ReceiptLink</span><span>Get paid. Send your work. Keep the proof.</span></div><div><span>Built on Monad · Testnet</span><button className="text-button muted" onClick={() => navigate('/setup')}>Prototype setup</button></div></footer>

    {walletPicker && <div className="modal-backdrop" onClick={() => setWalletPicker(false)}><section className="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title" onClick={e => e.stopPropagation()}><div className="panel-heading"><h2 id="wallet-title">Connect your wallet</h2><button className="icon-button" aria-label="Close wallet picker" onClick={() => setWalletPicker(false)}><X size={19}/></button></div><p>Choose a wallet to create or pay an invoice.</p>{connectors.map(connector => <button className="wallet-option" key={connector.uid} disabled={!!busy} onClick={async () => { setError(''); try { await connectAsync({ connector, chainId: CHAIN_ID }); setWalletPicker(false); } catch (e) { setError(friendlyError(e)); setWalletPicker(false); } }}><Wallet size={20}/><span>{connector.name === 'Injected' ? 'Browser wallet' : connector.name}</span><ArrowRight size={16}/></button>)}<p className="field-note">You control your keys. ReceiptLink never asks for your seed phrase.</p></section></div>}
  </div>;
}
