import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StepPlaceDogs from '../src/components/StepPlaceDogs';
import type { ConfigResponse } from '../src/types';
import '../src/App.css';

declare global {
  interface Window {
    __lastInpaintStart?: unknown[];
  }
}

const config: ConfigResponse = {
  views: {
    close: 'close camera',
  },
  styles: {
    flatvector: 'flat vector game art',
  },
  settings: {
    park: {
      label: 'City park',
      scenes: {
        bench: 'near a bench',
      },
    },
  },
  entities: {
    dog: 'dog',
  },
  entityPromptTemplate: '{entity}',
  models: [
    { id: 'openai/gpt-image-2', label: 'GPT Image 2' },
  ],
  inpaintModels: [
    { id: 'openai/gpt-image-2', label: 'GPT Image 2' },
  ],
  upscaleModels: [],
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <main className="app" style={{ minHeight: '100vh', padding: 24 }}>
      <StepPlaceDogs
        sessionId="step_place_dogs_prompt_contract"
        config={config}
        style="flatvector"
        setting="park"
        scene="bench"
        entity="dog"
        dogPrompt="a small hidden dog matching the selected recipe"
        includeStyleInInpaintPrompt
        hiddennessLevel="easy"
        hardHiddenPercent={30}
        inpaintPadding={2.75}
        inpaintModel="openai/gpt-image-2"
        radius={50}
        showOverlay
        hitboxes={[{ x: 30, y: 40, r: 10, id: 'dog-0' }]}
        inpainting={false}
        inpaintProgress={{ done: 0, total: 1 }}
        collapsed={false}
        inpaintStream={{
          start: (...args: unknown[]) => {
            window.__lastInpaintStart = args;
          },
          resume: () => undefined,
          stop: () => undefined,
          reset: () => undefined,
          status: {
            inpainting: false,
            inpaintFailed: false,
            inpaintError: null,
            inpaintProgress: { done: 0, total: 1, currentPass: 0, totalPasses: 0 },
          },
        }}
        onRadiusChange={() => undefined}
        onIncludeStyleInInpaintPromptChange={() => undefined}
        onHiddennessLevelChange={() => undefined}
        onHardHiddenPercentChange={() => undefined}
        onInpaintPaddingChange={() => undefined}
        onInpaintModelChange={() => undefined}
        onToggleOverlay={() => undefined}
      />
    </main>
  </QueryClientProvider>,
);
