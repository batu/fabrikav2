import { defineConfig, devices } from '@playwright/test';

// Render-proof harness for the Phaser lane authoring publisher (P5/P7).
//
// The proof loads a published `scenes/shell.js` in a real Chromium page running
// Phaser 4.2.1, waits on assets + fonts, and drives all seven shell states. It
// is deliberately OFFLINE and LOOPBACK-ONLY (card comment 15 §10/§11): the spec
// serves the published bundle from a loopback static server and the browser is
// launched with outbound network blocked except loopback, so the render can
// never reach a remote host. The spec itself is `*.spec.ts` (excluded from the
// vitest unit run in vitest.config.js).
export default defineConfig({
  testDir: 'test',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    // Baseline shell viewport (kernel v2 baseline is 390x844; card R5).
    viewport: { width: 390, height: 844 },
    // Block ALL outbound traffic except loopback — the render proof must be
    // network-free (R13/R27). The static bundle server binds to 127.0.0.1.
    launchOptions: {
      args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
    },
  },
});
