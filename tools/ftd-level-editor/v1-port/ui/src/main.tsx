import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { queryClient } from './api/queryClient';
import './App.css';

// QueryClientProvider wraps the app (plan -001 A2). The cache-of-server-truth
// shell runs ALONGSIDE the god-reducer (strangler) — the reducer stays the
// render source in A2; the cache is the foundation the Dogs canvas (B2) reads from.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
