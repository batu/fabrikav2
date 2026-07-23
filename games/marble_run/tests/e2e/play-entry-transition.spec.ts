import { expect, test } from '@playwright/test';

test.describe('menu to game transition', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });

  test('fades the live home in place without displacing any menu element', async ({ page }, testInfo) => {
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

    const trackedSelectors = [
      '.marble-home-header',
      '.marble-home-banner',
      '.marble-home-board-preview',
      '.fab-levelmap-path',
      '.fab-levelmap-node.current',
      '.marble-level-button',
    ] as const;
    const before = await page.evaluate((selectors) => Object.fromEntries(selectors.map((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return [selector, rect == null ? null : {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      }];
    })), trackedSelectors);

    await page.evaluate((selectors) => {
      const bindings = window as typeof window & {
        __MARBLE_TRANSITION_REVEAL_GEOMETRY__?: Record<string, {
          x: number;
          y: number;
          width: number;
          height: number;
        } | null> | null;
      };
      bindings.__MARBLE_TRANSITION_REVEAL_GEOMETRY__ = null;
      const overlay = document.getElementById('hud-overlay');
      if (overlay === null) throw new Error('HUD overlay missing before play entry');
      const observer = new MutationObserver(() => {
        if (overlay.getAttribute('data-play-entry-state') !== 'revealing') return;
        bindings.__MARBLE_TRANSITION_REVEAL_GEOMETRY__ = Object.fromEntries(selectors.map((selector) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          return [selector, rect == null ? null : {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          }];
        }));
        observer.disconnect();
      });
      observer.observe(overlay, { attributes: true, attributeFilter: ['data-play-entry-state'] });
    }, trackedSelectors);

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
    const animationStates = await page.evaluate(() => ({
      overlayBackdrop: getComputedStyle(document.querySelector('#hud-overlay')!, '::before').animationPlayState,
      sprinkle: getComputedStyle(document.querySelector('.marble-ambient-sprinkle')!).animationPlayState,
      currentNode: getComputedStyle(document.querySelector('.fab-levelmap-node.current .fab-levelmap-node-dot')!).animationPlayState,
      currentHalo: getComputedStyle(document.querySelector('.fab-levelmap-node.current')!, '::before').animationPlayState,
      levelButton: getComputedStyle(document.querySelector('.marble-level-button')!).animationPlayState,
    }));
    expect(animationStates).toEqual({
      overlayBackdrop: 'paused',
      sprinkle: 'paused',
      currentNode: 'paused',
      currentHalo: 'paused',
      levelButton: 'paused',
    });
    // The clone-into-cover mechanism is gone: no play-entry clone subtree exists.
    expect(await page.locator('.play-entry-home-shell').count()).toBe(0);
    const holding = await page.evaluate((selectors) => Object.fromEntries(selectors.map((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return [selector, rect == null ? null : {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      }];
    })), trackedSelectors);
    expect(holding).toEqual(before);

    await page.waitForFunction(
      () => (window as typeof window & {
        __MARBLE_TRANSITION_REVEAL_GEOMETRY__?: object | null;
      }).__MARBLE_TRANSITION_REVEAL_GEOMETRY__ != null,
      { timeout: 30_000 },
    );
    const midpoint = await page.evaluate(() => (window as typeof window & {
      __MARBLE_TRANSITION_REVEAL_GEOMETRY__?: object | null;
    }).__MARBLE_TRANSITION_REVEAL_GEOMETRY__);
    expect(midpoint).toEqual(before);

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
