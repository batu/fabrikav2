import React, { useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StepInpaint from '../src/components/StepInpaint';
import { sessionQueryKey } from '../src/api/useSessionQuery';
import '../src/App.css';
import type { SessionResponse } from '../src/types';

const sessionId = new URLSearchParams(window.location.search).get('session') ?? 'step_inpaint_retry_success';

function baseSession(): SessionResponse {
  return {
    id: sessionId,
    orientation: 'portrait',
    style: 'demo-style',
    model: 'demo-model',
    bgModel: 'demo-model',
    inpaintModel: 'openai/gpt-image-2',
    scenePrompt: 'demo scene',
    dogPrompt: 'a tiny dog',
    nDogs: 3,
    backgrounds: [{ index: 0, file: 'bg_00.png', generationTime: 1, width: 120, height: 120 }],
    selectedBgIndex: 0,
    bgWidth: 120,
    bgHeight: 120,
    sections: [],
    hitboxes: [{ x: 30, y: 40, r: 10 }, { x: 80, y: 70, r: 10 }, { x: 100, y: 95, r: 10 }],
    dogs: [
      { index: 0, status: 'done', activeVariant: 0, promptOverride: null, variants: ['dogs/dog_00/variant_000.png'] },
      { index: 1, status: 'error', activeVariant: null, promptOverride: null, variants: [] },
      { index: 2, status: 'done', activeVariant: 0, promptOverride: null, variants: ['dogs/dog_02/variant_000.png'] },
    ],
    setting: null,
    scene: null,
    entity: null,
    maskParams: { radial: 0, feather: 0 },
    exported: false,
    catalogUploaded: false,
    catalogListable: false,
    catalogTombstoned: false,
    bundledInApp: false,
  };
}

function Harness() {
  const queryClient = useMemo(() => new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }), []);

  useEffect(() => {
    queryClient.setQueryData(sessionQueryKey(sessionId), baseSession());
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <main className="app" style={{ minHeight: '100vh', padding: 24 }}>
        <StepInpaint
          sessionId={sessionId}
          config={null}
          style={null}
          setting={null}
          scene={null}
          dogPrompt="a tiny dog"
          includeStyleInInpaintPrompt
          hiddennessLevel="easy"
          hardHiddenPercent={30}
          inpaintPadding={2.75}
          inpaintModel="openai/gpt-image-2"
          showOverlay
          radius={50}
          collapsed={false}
          inpaintStream={{
            start: () => undefined,
            resume: () => undefined,
            stop: () => undefined,
            reset: () => undefined,
            status: {
              inpainting: false,
              inpaintFailed: false,
              inpaintError: null,
              inpaintProgress: { done: 2, total: 3, currentPass: 0, totalPasses: 0 },
            },
          }}
        />
      </main>
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing root');
createRoot(root).render(<Harness />);
