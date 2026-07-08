import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Alias the optional native ad plugin to the local web stub (mirrors vite.config
// + tsconfig paths) so importing the ads SDK in tests resolves without the
// native package installed.
const admobStub = fileURLToPath(
  new URL('./src/sdk/shims/capacitor-community-admob.ts', import.meta.url),
);

// Unit suites only. The e2e Playwright specs under tests/e2e/ are manual browser
// diagnostics (`npx playwright test --config games/marble_run/playwright.config.ts`),
// never vitest.
export default defineConfig({
  resolve: { alias: { '@capacitor-community/admob': admobStub } },
  test: {
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
});
