import { defineConfig } from "@playwright/test";
import { basePlaywrightConfig } from "../../configs/playwright.base.ts";

// e2e specs live under tests/e2e and run against the vite dev server. Kept as a
// working skeleton: the placeholder boot spec is real, not a stub.
export default defineConfig(
  basePlaywrightConfig({
    testDir: "tests/e2e",
    webServer: {
      command: "npm run dev",
      port: 5199,
      reuseExistingServer: !process.env.CI,
    },
    use: { baseURL: "http://localhost:5199" },
  }),
);
