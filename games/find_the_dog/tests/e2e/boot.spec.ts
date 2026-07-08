import { test, expect } from "@playwright/test";

test("boots the real Find the Dog shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#game-container")).toBeVisible();
  await expect(page.locator("#hud-overlay")).toBeAttached();
  await expect(page.locator("#game-container canvas")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#home-shell")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#home-map-mount")).toBeVisible();
  await expect(page.locator("#home-nav-play")).toBeVisible();
});
