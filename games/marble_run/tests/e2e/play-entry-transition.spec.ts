import { expect, test } from '@playwright/test';

test.describe('menu to game transition', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });

  test('fades the live home in place without cloning or reparenting it', async ({ page }, testInfo) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/');
    await expect(page.locator('#home-shell')).toBeVisible({ timeout: 30_000 });
    const liveBoard = page.locator('#hud-overlay > .marble-home-board-preview');
    await expect(liveBoard).toBeVisible({ timeout: 30_000 });

    // The home shell re-renders once after the async level index resolves; let
    // that settle so the baseline capture isn't taken from a detaching node.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.screenshot({ path: testInfo.outputPath('frame-00-live-menu.png') });

    await page.locator('.marble-level-button').first().tap();

    // The live overlay itself becomes the fade layer — no separate cover is
    // created, and the real home nodes are never moved out of #hud-overlay. This
    // is the renderer-proof invariant: nothing is cloned or reparented, so WebKit
    // paints the same nodes it already had on screen.
    const overlay = page.locator('#hud-overlay.home-play-entry');
    await expect(overlay).toHaveCount(1, { timeout: 30_000 });
    expect(await page.locator('#scene-transition-cover').count()).toBe(0);
    expect(await page.locator('#hud-overlay > #home-shell').count()).toBe(1);
    expect(await page.locator('#hud-overlay > .marble-home-board-preview').count()).toBe(1);
    // The clone-into-cover mechanism is gone: no play-entry clone subtree exists.
    expect(await page.locator('.play-entry-home-shell').count()).toBe(0);

    for (let frame = 1; frame < 8; frame += 1) {
      await page.waitForTimeout(120);
      await page.screenshot({ path: testInfo.outputPath(`frame-0${frame}-transition.png`) });
    }

    // The fade completes: the game is active, the home teardown has run, and the
    // overlay lift is dropped — never leaving a stuck cover.
    await page.waitForFunction(
      () => {
        const game = (window as unknown as { __FIND_DOG_GAME__?: { scene?: { isActive?: (key: string) => boolean } } })
          .__FIND_DOG_GAME__;
        const overlayEl = document.getElementById('hud-overlay');
        return game?.scene?.isActive?.('GameScene') === true
          && document.getElementById('scene-transition-cover') === null
          && overlayEl?.classList.contains('home-play-entry') === false;
      },
      { timeout: 30_000 },
    );
  });
});
