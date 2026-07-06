import { defineConfig } from 'vitest/config';

// Unit suites only. The e2e Playwright specs under tests/e2e/ run via
// `npm run e2e` (Playwright), never vitest.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
});
