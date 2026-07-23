import { expect, test } from '@playwright/test';

// Reuse the repository's dependency-free PNG decoder for an actual screenshot
// comparison instead of treating DOM geometry as a visual assertion.
// @ts-expect-error This shared JavaScript evidence helper intentionally has no declaration file.
import { decodePng } from '../../../../tools/refcap-compare/src/png.mjs';

function changedPixelFraction(beforePng: Buffer, afterPng: Buffer): number {
  const before = decodePng(beforePng);
  const after = decodePng(afterPng);
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);

  let changed = 0;
  for (let index = 0; index < before.data.length; index += 4) {
    const maxChannelDelta = Math.max(
      Math.abs(before.data[index]! - after.data[index]!),
      Math.abs(before.data[index + 1]! - after.data[index + 1]!),
      Math.abs(before.data[index + 2]! - after.data[index + 2]!),
      Math.abs(before.data[index + 3]! - after.data[index + 3]!),
    );
    if (maxChannelDelta > 16) changed += 1;
  }
  return changed / (before.data.length / 4);
}

test.describe('menu to game transition', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });

  test('preserves the live board through the frozen-frame handoff', async ({ page }, testInfo) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/');
    await expect(page.locator('#home-shell')).toBeVisible({ timeout: 30_000 });
    const liveBoard = page.locator('#hud-overlay > .marble-home-board-preview');
    await expect(liveBoard).toBeVisible({ timeout: 30_000 });

    const liveShell = await page.locator('#home-shell').screenshot({
      path: testInfo.outputPath('frame-00-live-menu-shell.png'),
    });
    const liveBoardPixels = await liveBoard.screenshot({
      path: testInfo.outputPath('frame-00-live-menu-board.png'),
    });

    await page.locator('#home-play-now').tap();
    const cover = page.locator('#scene-transition-cover');
    await expect(cover).toBeVisible({ timeout: 30_000 });
    await expect(cover.locator('.play-entry-home-shell')).toBeVisible();
    const frozenBoard = cover.locator('.marble-home-board-preview');
    await expect(frozenBoard).toBeVisible();

    const frozenShell = await cover.locator('.play-entry-home-shell').screenshot({
      path: testInfo.outputPath('frame-01-frozen-shell.png'),
    });
    const frozenBoardPixels = await frozenBoard.screenshot({
      path: testInfo.outputPath('frame-01-frozen-board.png'),
    });

    // The shell's clipped screenshot excludes the fade/backdrop layer. The
    // board screenshot is the exact moved canvas, so any change here signals a
    // clone/geometry regression rather than a level-render difference below.
    expect(changedPixelFraction(liveShell, frozenShell)).toBeLessThan(0.01);
    expect(changedPixelFraction(liveBoardPixels, frozenBoardPixels)).toBeLessThan(0.01);

    for (let frame = 2; frame < 8; frame += 1) {
      await page.waitForTimeout(160);
      await page.screenshot({ path: testInfo.outputPath(`frame-0${frame}-transition.png`) });
      const transitionState = await cover.getAttribute('data-transition-state');
      if (transitionState === 'arming' || transitionState === 'holding') {
        await expect(frozenBoard).toBeVisible();
      }
    }

    await page.waitForFunction(
      () => {
        const game = (window as unknown as { __FIND_DOG_GAME__?: { scene?: { isActive?: (key: string) => boolean } } })
          .__FIND_DOG_GAME__;
        return game?.scene?.isActive?.('GameScene') === true
          && document.getElementById('scene-transition-cover') === null;
      },
      { timeout: 30_000 },
    );
  });
});
