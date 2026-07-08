import { test, expect } from "@playwright/test";

test("boots the real Find the Dog shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#game-container")).toBeVisible();
  await expect(page.locator("#hud-overlay")).toBeAttached();
  await expect(page.locator("#game-container canvas")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#home-shell")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#home-map-mount")).toBeVisible();
  await expect(page.locator("#home-play-now")).toBeVisible();
  await expect(page.locator("#home-no-ads .home-side-btn-label")).toHaveCount(0);
  await expect(page.locator("#home-nav-play")).toBeVisible();
});

test("Play Now starts the current level from a real menu tap", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await expect(page.locator("#home-play-now")).toBeVisible({ timeout: 30000 });

  await page.locator("#home-play-now").tap();

  await page.waitForFunction(
    () => {
      const game = (window as unknown as { __FIND_DOG_GAME__?: { scene?: { isActive?: (key: string) => boolean } } })
        .__FIND_DOG_GAME__;
      return game?.scene?.isActive?.("GameScene") === true;
    },
    { timeout: 30000 },
  );
});
