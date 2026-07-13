import { defineConfig } from 'vitest/config';

// Scope the run to this workspace's own tests.
export default defineConfig({
  test: {
    include: ['test/**/*.test.mjs'],
    exclude: ['**/node_modules/**', '**/fixtures/**'],
  },
});
