import { test, expect } from "@playwright/test";

// Manual diagnostic only: browser proof is never a substitute for later device
// verification. It keeps a real rendered input path available when needed.
test("boots Progression Home and starts the current level", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('#app [data-fab-action="play"]')).toBeVisible();
  await page.locator('#app [data-fab-action="play"]').first().click();
  await expect(page.locator('#app [data-fab-action="test-win"]')).toBeVisible();
});
