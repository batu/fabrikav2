import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { baseViteConfig } from '../../configs/vite.base.ts';

// The optional native ad plugin (@capacitor-community/admob) is NOT a monorepo
// dependency (sdk DECISION S6); alias it to a local web stub so the ads SDK's
// static enum import resolves on web. Native shells swap the real module in.
const admobStub = fileURLToPath(
  new URL('./src/sdk/shims/capacitor-community-admob.ts', import.meta.url),
);

// Dedicated dev/build port for marble_run (v1 used 5201/5211; 5210 is free in v2).
export default defineConfig(
  baseViteConfig({
    server: { port: 5210 },
    resolve: { alias: { '@capacitor-community/admob': admobStub } },
  }),
);
