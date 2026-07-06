import { defineConfig } from '@playwright/test';
import { basePlaywrightConfig } from '../../configs/playwright.base.ts';

export default defineConfig(
  basePlaywrightConfig({
    // Scope to the e2e specs only. The base testDir ('tests') would also collect
    // the vitest unit suites under tests/unit (they use vitest globals +
    // vite-only import.meta.env and blow up under Playwright's loader). Unit
    // tests run via `npm run test:unit`; Playwright owns tests/e2e.
    testDir: 'tests/e2e',
    // Serialize this game's e2e project (root cause of the chaos flake). All
    // specs drive ONE shared vite dev server; at the base default of 5 parallel
    // workers they contend for it, and the long seeded-chaos run (40 verbs,
    // ~24s solo — see chaos.spec) had its many harness round-trips slowed past
    // the 30s per-test timeout only when 4 siblings ran alongside it. Invariants
    // never failed — it was pure contention, so we remove it rather than widen
    // timeouts. One worker = no cross-spec contention on the single server.
    workers: 1,
    webServer: {
      command: 'npm run dev',
      port: 5210,
      reuseExistingServer: !process.env.CI,
    },
    use: { baseURL: 'http://localhost:5210' },
  }),
);
