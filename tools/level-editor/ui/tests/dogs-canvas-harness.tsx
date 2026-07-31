import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DogsCanvas from '../src/components/DogsCanvas';

// DogsCanvas in ISOLATION — no wizard, no real backend, no tunnel. The network
// is mocked by the smoke test (page.route), so this harness eliminates all three
// live-verification gremlins (wrong-canvas, stale-backend, wizard-mount-save)
// and asserts the WIRE contract: what DogsCanvas sends on drag / place / delete.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <div style={{ width: 480 }}>
      <DogsCanvas sessionId="test-session" />
    </div>
  </QueryClientProvider>,
);
