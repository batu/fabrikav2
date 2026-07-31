import React, { useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useInpaintStream } from '../src/api/useInpaintStream';
import { sessionQueryKey } from '../src/api/useSessionQuery';
import type { SessionResponse } from '../src/types';

const sessionId = 'inpaint_job_demo';
const hitboxes = [{ x: 25, y: 30, r: 8, id: 'dog-0' }, { x: 80, y: 90, r: 8, id: 'dog-1' }];

function session(dogStatuses: Array<'pending' | 'generating' | 'done' | 'error'>): SessionResponse {
  return {
    id: sessionId,
    orientation: 'portrait',
    style: 'demo-style',
    model: 'openai/gpt-image-2',
    bgModel: 'openai/gpt-image-2',
    inpaintModel: 'openai/gpt-image-2',
    scenePrompt: 'demo scene',
    dogPrompt: 'a tiny dog',
    nDogs: 2,
    backgrounds: [{ index: 0, file: 'bg_00.png', generationTime: 1, width: 120, height: 120 }],
    selectedBgIndex: 0,
    bgWidth: 120,
    bgHeight: 120,
    sections: [],
    hitboxes,
    dogs: dogStatuses.map((status, index) => ({
      index,
      id: hitboxes[index].id,
      status,
      activeVariant: status === 'done' ? 0 : null,
      promptOverride: null,
      variants: status === 'done' ? [`dogs/dog_0${index}/variant_000.png`] : [],
      ...(status === 'error' ? { error: 'failed' } : {}),
    })),
    setting: null,
    scene: null,
    entity: null,
    exported: false,
  };
}

function Harness() {
  const queryClient = useQueryClient();
  const stream = useInpaintStream();
  const autoResume = new URLSearchParams(window.location.search).get('resume') === '1';
  const current = queryClient.getQueryData<SessionResponse>(sessionQueryKey(sessionId));

  useEffect(() => {
    queryClient.setQueryData(sessionQueryKey(sessionId), session(['pending', 'pending']));
  }, [queryClient]);

  useEffect(() => {
    if (autoResume) stream.resume(sessionId);
  }, [autoResume, stream.resume]);

  return (
    <main>
      <button
        type="button"
        onClick={() => stream.start(sessionId, hitboxes, 'a tiny dog', 'crop', '', 'openai/gpt-image-2', '', 30, 2.75)}
      >
        Start crop job
      </button>
      <div data-testid="inpaint-state">
        {stream.status.inpainting ? 'running' : stream.status.inpaintFailed ? 'failed' : 'idle'}
        {' '}
        {stream.status.inpaintProgress.done}/{stream.status.inpaintProgress.total}
      </div>
      <div data-testid="dogs-state">{current?.dogs.map((dog) => dog.status).join(',') ?? 'none'}</div>
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
