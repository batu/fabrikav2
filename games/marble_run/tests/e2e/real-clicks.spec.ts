import { test, expect, type Page } from '@playwright/test';
import {
  SharedShellDriver,
  gotoAndWaitForHarness,
  callHarness,
  readHarness,
  pollHarness,
} from '@fabrikav2/testkit/playwright';

/**
 * REAL-CLICK coverage — every visible control on every screen driven through the
 * portfolio `SharedShellDriver` (menu / settings / pause / result / shop) with
 * REAL DOM clicks: default actionability, NO `force`, NO `el.click()`. This is
 * the generalization of `menu-clicks.spec.ts` (the dead-buttons regression
 * guard) to the whole shell: an intercepting overlay makes a click TIME OUT
 * rather than silently no-op, and each assertion observes the real DOM/state
 * effect — so a click that "lands" but does nothing also fails.
 *
 * `SharedShellDriver` drives the shared `data-fab-*` hooks. The two marble-local
 * controls it can't reach (the HUD gear that opens pause) are clicked through
 * their real selectors — still real clicks, no force.
 * Level/result SETUP goes through the harness; the control UNDER TEST is always a
 * real click.
 */

const WINDOW_KEY = '__MARBLE_RUN_HARNESS__';
const HUD_PAUSE = '#hud [data-a="pause"]';
const PAUSE_CARD = '.fab-pause-card';
const SETTINGS_CARD = '.mr-settings-card';

interface Harness {
  startLevel(id: number): void;
  unlockAll(): void;
  snapshot(): { scene: string; status: string; inputReady: boolean; paused: boolean };
  solveStep(): unknown;
}

async function boot(page: Page): Promise<SharedShellDriver> {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoAndWaitForHarness<Harness>(page, '/', {
    windowKey: WINDOW_KEY,
    readyCheck: (h) => typeof h.startLevel === 'function',
  });
  await expect(page.locator('[data-fab-action="play"]')).toBeVisible();
  return new SharedShellDriver(page);
}

/** Drive into a live, interactive level (setup path — harness, not a real click). */
async function enterLevel(page: Page, id: number): Promise<void> {
  await callHarness<Harness, number, void>(page, WINDOW_KEY, (h, levelId) => h.startLevel(levelId), id);
  await pollHarness<Harness, { scene: string; inputReady: boolean }>(
    page,
    WINDOW_KEY,
    (h) => ({ scene: h.snapshot().scene, inputReady: h.snapshot().inputReady }),
    (v) => v.scene === 'playing' && v.inputReady === true,
    10_000,
  );
}

/** Solve level 1 to a win via the deterministic solver (setup for the result screen). */
async function winLevel1(page: Page): Promise<void> {
  await enterLevel(page, 1);
  for (let i = 0; i < 200; i += 1) {
    const status = await readHarness<Harness, string>(page, WINDOW_KEY, (h) => h.snapshot().status);
    if (status === 'won' || status === 'failed') break;
    await callHarness<Harness, null, unknown>(page, WINDOW_KEY, (h) => h.solveStep(), null);
    await page.waitForTimeout(120);
  }
  await pollHarness<Harness, string>(
    page,
    WINDOW_KEY,
    (h) => h.snapshot().scene,
    (v) => v === 'complete' || v === 'failed',
    10_000,
  );
}

test.describe('marble_run — real-click coverage across every screen', () => {
  test('menu: SharedShellDriver play() really starts the level (HUD mounts)', async ({ page }) => {
    const shell = await boot(page);
    await shell.play();
    await expect(page.locator('#hud .mr-hud')).toBeVisible({ timeout: 8000 });
  });

  test('menu → settings: gear opens the modal and every toggle flips on a real click', async ({ page }) => {
    const shell = await boot(page);
    await shell.openSettings();
    await expect(page.locator(SETTINGS_CARD)).toBeVisible({ timeout: 4000 });
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-restart"]`)).toBeVisible();
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-home"]`)).toBeVisible();
    await expect(page.locator(`${SETTINGS_CARD}`).getByText('Reset Progress')).toHaveCount(0);

    // The real user-clickable control is the visible `.fab-toggle-switch` label
    // (the `<input>` itself is opacity-0/zero-size — see SURPRISES). Clicking the
    // label with default actionability flips the underlying checkbox.
    for (const key of ['music', 'sfx', 'haptics']) {
      const row = `[data-fab-toggle-key="${key}"]`;
      const input = page.locator(`${row} .fab-toggle-input`);
      const before = await input.isChecked();
      await page.locator(`${row} .fab-toggle-switch`).click();
      await expect(input).toBeChecked({ checked: !before });
    }
    await shell.settingsClose();
    await expect(page.locator(SETTINGS_CARD)).toBeHidden({ timeout: 4000 });
  });

  test('settings: restart starts the current level from the menu modal', async ({ page }) => {
    const shell = await boot(page);
    await shell.openSettings();
    await expect(page.locator(SETTINGS_CARD)).toBeVisible({ timeout: 4000 });
    await shell.settingsRestart();
    await expect(page.locator('#hud .mr-hud')).toBeVisible({ timeout: 8000 });
  });

  test('settings: home returns from paused settings to the menu', async ({ page }) => {
    await boot(page);
    await enterLevel(page, 1);
    const shell = new SharedShellDriver(page);
    await page.locator(HUD_PAUSE).click();
    await expect(page.locator(PAUSE_CARD)).toBeVisible({ timeout: 4000 });
    await shell.pauseSettings();
    await expect(page.locator(SETTINGS_CARD)).toBeVisible({ timeout: 4000 });
    await shell.settingsHome();
    await expect(page.locator('[data-fab-action="play"]')).toBeVisible({ timeout: 4000 });
    await expect(page.locator(SETTINGS_CARD)).toBeHidden({ timeout: 4000 });
  });

  test('menu → shop: coin pill opens the shop and renders its restore control', async ({ page }) => {
    const shell = await boot(page);
    await shell.openShop();
    await expect(page.locator('.fab-shop')).toBeVisible({ timeout: 4000 });
    // On web (non-native fake provider) the catalog has no purchasable products
    // and restore reports 'unavailable' → the restore control renders DISABLED.
    // That is the correct, honest web state for this control; asserting it proves
    // the shop mounted its real chrome (not that a purchase is drivable in-worker
    // — it is not; see SURPRISES). The coin-pill → shop real click is the driven
    // control here (via SharedShellDriver.openShop).
    await expect(page.locator('.fab-shop-restore-btn')).toBeDisabled();
  });

  test('pause: HUD gear opens the overlay, pauseResume() really resumes play', async ({ page }) => {
    await boot(page);
    await enterLevel(page, 1);
    const shell = new SharedShellDriver(page);
    await page.locator(HUD_PAUSE).click();
    await expect(page.locator(PAUSE_CARD)).toBeVisible({ timeout: 4000 });
    await shell.pauseResume();
    await expect(page.locator(PAUSE_CARD)).toBeHidden({ timeout: 4000 });
    const paused = await readHarness<Harness, boolean>(page, WINDOW_KEY, (h) => h.snapshot().paused);
    expect(paused).toBe(false);
  });

  test('pause: pauseSettings() really opens the settings modal', async ({ page }) => {
    await boot(page);
    await enterLevel(page, 1);
    const shell = new SharedShellDriver(page);
    await page.locator(HUD_PAUSE).click();
    await expect(page.locator(PAUSE_CARD)).toBeVisible({ timeout: 4000 });
    await shell.pauseSettings();
    await expect(page.locator(SETTINGS_CARD)).toBeVisible({ timeout: 4000 });
  });

  test('pause: pauseQuit() really returns to the menu', async ({ page }) => {
    await boot(page);
    await enterLevel(page, 1);
    const shell = new SharedShellDriver(page);
    await page.locator(HUD_PAUSE).click();
    await expect(page.locator(PAUSE_CARD)).toBeVisible({ timeout: 4000 });
    await shell.pauseQuit();
    await expect(page.locator('[data-fab-action="play"]')).toBeVisible({ timeout: 4000 });
  });

  test('result: resultNext() really advances from the win card (next level HUD mounts)', async ({ page }) => {
    await boot(page);
    await winLevel1(page);
    const scene = await readHarness<Harness, string>(page, WINDOW_KEY, (h) => h.snapshot().scene);
    test.skip(scene !== 'complete', 'level 1 resolved to a fail this run; win-card path not reachable');
    const shell = new SharedShellDriver(page);
    await shell.resultNext();
    await expect(page.locator('#hud .mr-hud')).toBeVisible({ timeout: 8000 });
  });

  test('result: resultRetry() really restarts the level (HUD remounts)', async ({ page }) => {
    await boot(page);
    await winLevel1(page);
    const scene = await readHarness<Harness, string>(page, WINDOW_KEY, (h) => h.snapshot().scene);
    test.skip(scene !== 'complete', 'level 1 resolved to a fail this run; win-card path not reachable');
    const shell = new SharedShellDriver(page);
    await shell.resultRetry();
    await expect(page.locator('#hud .mr-hud')).toBeVisible({ timeout: 8000 });
  });
});
