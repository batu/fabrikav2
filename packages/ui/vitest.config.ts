import { defineConfig } from 'vitest/config';

// DOM primitives need a browser-like environment. happy-dom is the sanctioned
// root devDependency (card VD1JPfyY, conductor authorization) — lighter than
// jsdom and sufficient for these component tests.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
});
