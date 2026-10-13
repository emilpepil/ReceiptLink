import { defineChain, parseAbi } from 'viem';

export const CHAIN_ID = 10143;
export const USDC_ADDRESS = '0x534b2f3A21130d7a60830c2Df862319e593943A3' as const;
export const monadTestnet = defineChain({
  id: CHAIN_ID,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' } },
  testnet: true,
});

export const receiptAbi = parseAbi([
  'function createInvoice(bytes32 id, uint256 amount, bytes32 metadataHash)',
  'function pay(bytes32 id)',
  'function cancelInvoice(bytes32 id)',
  'function getInvoice(bytes32 id) view returns ((address seller, uint256 amount, bytes32 metadataHash, uint8 status, address payer, uint64 paidAt))',
  'function paymentToken() view returns (address)',
  'event InvoiceCreated(bytes32 indexed id, address indexed seller, uint256 amount, bytes32 metadataHash)',
  'event Paid(bytes32 indexed id, address indexed payer, address indexed seller, uint256 amount)',
  'event InvoiceCancelled(bytes32 indexed id)',
  'error InvoiceAlreadyExists()',
  'error InvoiceNotOpen()',
  'error InvalidInvoice()',
  'error Unauthorized()',
]);

export type PublicInvoice = {
  id: `0x${string}`;
  title: string;
  description: string;
  amount: string;
  seller: `0x${string}`;
  metadataHash: `0x${string}`;
  hasDelivery: boolean;
  status: 'draft' | 'open' | 'paid' | 'cancelled';
  payer?: `0x${string}`;
  paidAt?: number;
  transactionHash?: `0x${string}`;
  createdAt: number;
};

export type AppConfig = {
  chainId: number;
  contractAddress: `0x${string}` | null;
  tokenAddress: `0x${string}`;
  tokenSymbol: 'USDC';
};
