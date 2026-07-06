import { defineConfig } from '@playwright/test';
import { basePlaywrightConfig } from '../../configs/playwright.base.ts';

export default defineConfig(
  basePlaywrightConfig({
    // Scope to the e2e specs only. The base testDir ('tests') would also collect
    // the vitest unit suites under tests/unit (they use vitest globals +
    // vite-only import.meta.env and blow up under Playwright's loader). Unit
    // tests run via `npm run test:unit`; Playwright owns tests/e2e.
    testDir: 'tests/e2e',
    webServer: {
      command: 'npm run dev',
      port: 5210,
      reuseExistingServer: !process.env.CI,
    },
    use: { baseURL: 'http://localhost:5210' },
  }),
);
