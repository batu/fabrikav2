import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('Missing #root mount');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
