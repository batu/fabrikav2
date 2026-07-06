import { defineConfig } from '@playwright/test';
import { basePlaywrightConfig } from '../../configs/playwright.base.ts';

export default defineConfig(
  basePlaywrightConfig({
    webServer: {
      command: 'npm run dev',
      port: 5210,
      reuseExistingServer: !process.env.CI,
    },
    use: { baseURL: 'http://localhost:5210' },
  }),
);
