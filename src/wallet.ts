import { createConfig, http } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import { monadTestnet } from '../shared/chain';

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
export const walletConfig = createConfig({
  chains: [monadTestnet],
  connectors: [injected(), ...(projectId ? [walletConnect({ projectId, showQrModal: true, metadata: { name: 'ReceiptLink', description: 'Get paid. Send your work.', url: window.location.origin, icons: [] } })] : [])],
  transports: { [monadTestnet.id]: http() },
});
