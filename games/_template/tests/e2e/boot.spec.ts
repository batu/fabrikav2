import { test, expect } from "@playwright/test";

// End-to-end skeleton: the game boots in a real browser and mounts the
// placeholder screen into #app. Runs against the vite dev server started by
// playwright.config.ts. A real port grows this into the game's smoke flow.
test("boots and shows the placeholder screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app .fab-placeholder-screen")).toBeVisible();
});
