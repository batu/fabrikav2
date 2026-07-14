import { defineConfig } from "@playwright/test";
import { basePlaywrightConfig } from "../../configs/playwright.base.ts";

// e2e specs live under tests/e2e and run against the vite dev server. They are
// manual diagnostics; device verification owns mobile runtime proof.
export default defineConfig(
  basePlaywrightConfig({
    testDir: "tests/e2e",
    webServer: {
      command: "npm run dev",
      port: 5302,
      reuseExistingServer: !process.env.CI,
    },
    use: { baseURL: "http://localhost:5302" },
  }),
);
