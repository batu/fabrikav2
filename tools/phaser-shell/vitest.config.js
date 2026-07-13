import { defineConfig } from 'vitest/config';

// Scope the unit run to this workspace's own tests. Both the U1 preseed
// resolution proof (.mjs) and the U5 authoring/publisher suites (.ts) are
// included; the Playwright render-proof spec (*.spec.ts) is NOT a vitest suite
// and is excluded so it never runs under the unit runner.
export default defineConfig({
  test: {
    include: ['test/**/*.test.mjs', 'test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/fixtures/**', '**/*.spec.ts'],
  },
});
