import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { walletConfig } from './wallet';
import App from './App';
import './styles.css';

const queryClient = new QueryClient();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><WagmiProvider config={walletConfig}><QueryClientProvider client={queryClient}><App /></QueryClientProvider></WagmiProvider></React.StrictMode>,
);
