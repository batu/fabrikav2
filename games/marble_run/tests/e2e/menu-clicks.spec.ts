import { test, expect, type Page } from '@playwright/test';

/**
 * P1a REGRESSION GUARD — real-click e2e for EVERY menu button.
 *
 * The dead-buttons bug (a full-bleed `.fab-toaster` with `pointer-events: auto`,
 * forced by the `#ui > *` blanket, swallowing menu clicks) passed the old suite
 * because that suite drives `window.__MARBLE_RUN_HARNESS__` (JS calls) instead of
 * clicking real DOM. These tests use Playwright `locator.click()` with DEFAULT
 * actionability — NO harness shortcuts, NO `force: true`, NO `dispatchEvent` — so
 * any layer that intercepts the click makes the test FAIL (the click times out).
 * This is the guarantee the card demands: this class must never pass silently.
 *
 * Assertions observe real DOM effects (HUD mounts, modal/page appears), not the
 * harness, so a click that "lands" but does nothing also fails.
 */

const MENU_CTA = '[data-fab-action="play"]';

async function gotoMenu(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  // The app boots straight into the menu; wait for the primary CTA to be ready.
  await expect(page.locator(MENU_CTA)).toBeVisible();
  // Give the decorative board / saga a beat to settle so nodes are stable.
  await page.waitForTimeout(300);
}

test.describe('marble_run — menu buttons are really clickable (P1a)', () => {
  test('LEVEL button: a REAL click starts the level (HUD mounts)', async ({ page }) => {
    await gotoMenu(page);
    // No force, default actionability → an intercepting overlay times this out.
    await page.locator(MENU_CTA).click();
    // Real DOM effect: the in-level HUD mounts in #hud.
    await expect(page.locator('#hud .mr-hud')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#hud .mr-hearts-panel')).toBeVisible();
  });

  test('gear button: a REAL click opens the settings modal', async ({ page }) => {
    await gotoMenu(page);
    await page.locator('[data-fab-action="settings"]').click();
    await expect(page.locator('.mr-settings-card')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('.mr-settings-card .fab-toggle-row')).toHaveCount(3);
  });

  test('coin pill: a REAL click opens the shop', async ({ page }) => {
    await gotoMenu(page);
    await page.locator('[data-fab-action="shop"]').click();
    await expect(page.locator('.fab-shop')).toBeVisible({ timeout: 4000 });
  });

  test('current saga node: a REAL click starts the level', async ({ page }) => {
    await gotoMenu(page);
    // The current node is the playable one (v1 parity: locked nodes are no-ops).
    await page.locator('.fab-levelmap-node.current').click();
    await expect(page.locator('#hud .mr-hud')).toBeVisible({ timeout: 8000 });
  });

  test('elementFromPoint at the CTA centre is the CTA, not an overlay', async ({ page }) => {
    await gotoMenu(page);
    const owner = await page.evaluate((sel) => {
      const btn = document.querySelector(sel) as HTMLElement;
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) as HTMLElement;
      // The hit element must BE the button or live inside it — not a sibling overlay.
      return { intercepted: hit !== btn && !btn.contains(hit), hitClass: hit?.className ?? '' };
    }, MENU_CTA);
    expect(owner.intercepted, `click intercepted by "${owner.hitClass}"`).toBe(false);
  });
});
