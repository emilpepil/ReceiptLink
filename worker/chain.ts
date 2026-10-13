import { createPublicClient, getAddress, http, type Address, type Hex } from 'viem';
import { monadTestnet, receiptAbi } from '../shared/chain';

export type ChainInvoice = {
  seller: Address; amount: bigint; metadataHash: Hex; status: number; payer: Address; paidAt: bigint;
};
export type ChainReceipt = {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  logs: { address: Address; data: Hex; topics: readonly Hex[] }[];
};
export type ChainReader = {
  paymentToken: () => Promise<Address>;
  invoice: (id: Hex) => Promise<ChainInvoice>;
  receipt: (hash: Hex) => Promise<ChainReceipt>;
};

export function createChainReader(contract: Address, rpcUrl: string): ChainReader {
  const client = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl, { batch: false, timeout: 12_000, retryCount: 1 }) });
  return {
    paymentToken: () => client.readContract({ address: contract, abi: receiptAbi, functionName: 'paymentToken', blockTag: 'finalized' }),
    invoice: id => client.readContract({ address: contract, abi: receiptAbi, functionName: 'getInvoice', args: [id], blockTag: 'finalized' }),
    receipt: async hash => {
      const receipt = await client.getTransactionReceipt({ hash });
      const finalized = await client.getBlock({ blockTag: 'finalized' });
      if (receipt.blockNumber > finalized.number) throw new Error('Payment is not finalized yet.');
      return receipt;
    },
  };
}

export const sameAddress = (a: string, b: string) => getAddress(a) === getAddress(b);
