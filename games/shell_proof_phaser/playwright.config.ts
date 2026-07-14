import { defineConfig } from "@playwright/test";
import { basePlaywrightConfig } from "../../configs/playwright.base.ts";

// e2e specs live under tests/e2e and run against the vite dev server. They are
// manual diagnostics; device verification owns mobile runtime proof.
export default defineConfig(
  basePlaywrightConfig({
    testDir: "tests/e2e",
    webServer: {
      command: "npm run build && npx vite preview --host 127.0.0.1 --port 5319",
      port: 5319,
      reuseExistingServer: !process.env.CI,
    },
    use: {
      baseURL: "http://localhost:5319",
      launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
    },
  }),
);
