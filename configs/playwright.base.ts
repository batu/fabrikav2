// Shared Playwright base config helper for fabrika v2 games and testkit.
//
// Consume from a workspace's playwright.config.ts:
//   import { defineConfig } from "@playwright/test";
//   import { basePlaywrightConfig } from "../../configs/playwright.base";
//   export default defineConfig(basePlaywrightConfig({ webServer: { command: "npm run dev", port: 5200 } }));
//
// One pinned Playwright major at root. Keep this thin — per-game webServer /
// project specifics go in the workspace's own config via overrides.
import type { PlaywrightTestConfig } from "@playwright/test";

export function basePlaywrightConfig(
  overrides: PlaywrightTestConfig = {},
): PlaywrightTestConfig {
  return {
    testDir: "tests",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? "github" : "list",
    ...overrides,
    use: {
      trace: "on-first-retry",
      ...overrides.use,
    },
  };
}
