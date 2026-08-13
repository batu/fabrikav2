import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LevelCanvas, { type LevelCanvasState } from '../src/components/LevelCanvas';
import '../src/App.css';

// Evidence harness for the runtime-truth tap-square overlay: a square 2688
// level with r=57 hitboxes, including one close pair so the neighbor clamp
// is visible.
const state: LevelCanvasState = {
  sessionId: 'overlay-evidence',
  bgWidth: 2688,
  bgHeight: 2688,
  selectedBgIndex: 0,
  orientation: 'portrait',
  sections: [],
  hitboxes: [
    { x: 600, y: 700, r: 57, id: 'a1' },
    { x: 1500, y: 900, r: 57, id: 'b2' },
    { x: 2100, y: 1600, r: 57, id: 'c3' },
    // Close pair: centers 190px apart -> clamp beats the 2x square.
    { x: 900, y: 1900, r: 57, id: 'd4' },
    { x: 1090, y: 1900, r: 57, id: 'e5' },
  ],
  dogs: [],
  selectedDogIndex: 1,
  showOverlay: true,
  radius: 57,
  inpaintPadding: 2.75,
};

const gray =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2688" height="2688">' +
    '<rect width="2688" height="2688" fill="#c9b896"/></svg>',
  );

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <main style={{ width: 900, height: 900 }}>
      <LevelCanvas state={state} readOnly hideDeadZones backgroundOverride={gray} />
    </main>
  </QueryClientProvider>,
);
