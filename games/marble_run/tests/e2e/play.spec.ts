import { test, expect } from '@playwright/test';
import {
  gotoAndWaitForHarness,
  callHarness,
  readHarness,
  pollHarness,
} from '@fabrikav2/testkit/playwright';

/**
 * AC e2e: menu -> level -> win/fail loop with the v2 screens, driven through the
 * window test harness the shell exposes (App.harness()). Authored here; the
 * conductor executes it (Playwright does not run in the worker sandbox — see the
 * card handoff). The harness reader/predicate fns are .toString()-serialized and
 * rebuilt in the browser, so they must be self-contained (no closure captures).
 */

const WINDOW_KEY = '__MARBLE_RUN_HARNESS__';

interface Harness {
  gotoMenu(): void;
  startLevel(id: number): void;
  solveStep(): unknown;
  snapshot(): {
    scene: string;
    status: string;
    inputReady: boolean;
    sagaNodeIds: Array<string | number>;
  };
  sagaNodes(): Array<string | number>;
  unlockAll(): void;
}

test.describe('marble_run — menu to level to result loop', () => {
  test('boots into the menu with a saga rail', async ({ page }) => {
    await gotoAndWaitForHarness<Harness>(page, '/', {
      windowKey: WINDOW_KEY,
      readyCheck: (h) => typeof h.startLevel === 'function',
    });

    await callHarness<Harness, null, void>(page, WINDOW_KEY, (h) => h.gotoMenu(), null);

    const scene = await readHarness<Harness, string>(page, WINDOW_KEY, (h) => h.snapshot().scene);
    expect(scene).toBe('menu');

    const nodes = await readHarness<Harness, Array<string | number>>(
      page,
      WINDOW_KEY,
      (h) => h.sagaNodes(),
    );
    expect(nodes.length).toBeGreaterThan(0);

    // The HomeMenu screen (v2 ui) is mounted into #ui.
    await expect(page.locator('#ui')).not.toBeEmpty();
  });

  test('plays level 1 to a terminal result screen (win or fail)', async ({ page }) => {
    await gotoAndWaitForHarness<Harness>(page, '/', {
      windowKey: WINDOW_KEY,
      readyCheck: (h) => typeof h.startLevel === 'function',
    });

    await callHarness<Harness, number, void>(page, WINDOW_KEY, (h, id) => h.startLevel(id), 1);

    // Wait for the level to become interactive.
    await pollHarness<Harness, { scene: string; inputReady: boolean }>(
      page,
      WINDOW_KEY,
      (h) => {
        const s = h.snapshot();
        return { scene: s.scene, inputReady: s.inputReady };
      },
      (v) => v.scene === 'playing' && v.inputReady === true,
      10_000,
    );

    // Drive the greedy solver one movable at a time until the run terminates.
    for (let i = 0; i < 200; i += 1) {
      const status = await readHarness<Harness, string>(
        page,
        WINDOW_KEY,
        (h) => h.snapshot().status,
      );
      if (status === 'won' || status === 'failed') break;
      await callHarness<Harness, null, unknown>(page, WINDOW_KEY, (h) => h.solveStep(), null);
      await page.waitForTimeout(120);
    }

    // The flow machine should have advanced to a terminal state and mounted the
    // matching ResultCard.
    const scene = await pollHarness<Harness, string>(
      page,
      WINDOW_KEY,
      (h) => h.snapshot().scene,
      (v) => v === 'complete' || v === 'failed',
      10_000,
    );
    expect(['complete', 'failed']).toContain(scene);
    await expect(page.locator('#ui')).not.toBeEmpty();
  });
});
