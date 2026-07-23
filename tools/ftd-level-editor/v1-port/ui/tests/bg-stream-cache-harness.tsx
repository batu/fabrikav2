import React, { useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useBgStream } from '../src/api/useBgStream';
import { sessionQueryKey } from '../src/api/useSessionQuery';
import type { SessionResponse } from '../src/types';

type Listener = (event: MessageEvent) => void;

class FakeEventSource {
  readonly url: string;
  closed = false;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    window.__bgEventSources.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
}

declare global {
  interface Window {
    __bgEventSources: FakeEventSource[];
  }
}

window.__bgEventSources = [];
window.EventSource = FakeEventSource as unknown as typeof EventSource;

const sessionId = 'bg_stream_cache_seed';

function cachedSession(queryClient: QueryClient): SessionResponse | undefined {
  return queryClient.getQueryData<SessionResponse>(sessionQueryKey(sessionId));
}

function Harness() {
  const queryClient = useQueryClient();
  const bgStream = useBgStream();
  const session = cachedSession(queryClient);

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <button
        data-testid="start"
        onClick={() => bgStream.start(sessionId, { total: 1 })}
      >
        Start
      </button>
      <button
        data-testid="resume"
        onClick={() => bgStream.resume(sessionId, 'bg-job-resume')}
      >
        Resume
      </button>
      <div data-testid="event-source-count">{window.__bgEventSources.length}</div>
      <div data-testid="background-count">{session?.backgrounds.length ?? 0}</div>
      <div data-testid="generation-status">
        {bgStream.status.generating ? 'generating' : 'idle'}:{bgStream.status.generationProgress.succeeded}
      </div>
      <div data-testid="background-job">
        {bgStream.status.generationJobId ?? 'no-job'}:{bgStream.status.generationJobStatus ?? 'unknown'}
      </div>
      <div data-testid="generation-errors">{bgStream.status.generationErrors.join('\n')}</div>
    </main>
  );
}

function App() {
  const queryClient = useMemo(() => new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }), []);

  return (
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing root');
createRoot(root).render(<App />);
