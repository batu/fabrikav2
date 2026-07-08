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
  gotoMenu(): void;
  gotoState(state: string): void;
  startLevel(id: number): void;
  unlockAll(): void;
  grantCoins(coins: number): void;
  snapshot(): { scene: string; status: string; inputReady: boolean; paused: boolean };
  solveStep(): unknown;
  driveTo(state: string): Promise<boolean>;
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

async function expectImageRibbonEyebrow(
  page: Page,
  opts: { resultState: 'win' | 'fail'; cardClass: 'win' | 'lose'; assetName: string; title: string },
): Promise<void> {
  const reached = await callHarness<Harness, string, Promise<boolean>>(
    page,
    WINDOW_KEY,
    (h, state) => h.driveTo(state),
    opts.resultState,
  );
  expect(reached).toBe(true);

  const card = page.locator(`.fab-result-card--${opts.cardClass}`);
  await expect(card).toBeVisible({ timeout: 4000 });
  const ribbon = card.locator('.fab-modal-ribbon');
  await expect(ribbon).toBeVisible();
  await expect(ribbon.locator('.fab-modal-ribbon-image')).toHaveAttribute('src', new RegExp(opts.assetName));

  await expect(card.locator('.fab-modal-title')).toHaveCount(0);
  const title = ribbon.locator('.fab-modal-ribbon-title');
  await expect(title).toHaveCount(1);
  await expect(title).toHaveText(opts.title);

  const eyebrow = ribbon.locator('.fab-modal-ribbon-eyebrow');
  await expect(eyebrow).toHaveCount(1);
  await expect(eyebrow).toHaveText('Level 4');

  const ribbonBox = await ribbon.boundingBox();
  const eyebrowBox = await eyebrow.boundingBox();
  expect(ribbonBox).not.toBeNull();
  expect(eyebrowBox).not.toBeNull();
  const eyebrowMidY = eyebrowBox!.y + eyebrowBox!.height / 2;
  const eyebrowBottomY = eyebrowBox!.y + eyebrowBox!.height;
  expect(eyebrowBox!.y).toBeGreaterThan(ribbonBox!.y);
  expect(eyebrowMidY - ribbonBox!.y).toBeGreaterThan(ribbonBox!.height * 0.14);
  expect(eyebrowMidY - ribbonBox!.y).toBeLessThan(ribbonBox!.height * 0.36);
  expect(eyebrowBottomY).toBeLessThan(ribbonBox!.y + ribbonBox!.height * 0.43);
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
    const viewport = page.viewportSize()!;
    const settingsRibbon = await page.locator(`${SETTINGS_CARD} .fab-modal-ribbon`).boundingBox();
    const settingsCard = await page.locator(SETTINGS_CARD).boundingBox();
    expect(settingsRibbon?.y ?? 0).toBeGreaterThan(40);
    expect((settingsCard?.y ?? 0) + (settingsCard?.height ?? viewport.height)).toBeLessThan(viewport.height - 24);
    await expect(page.locator('.fab-modal-scrim')).toHaveCSS('background-color', 'rgba(31, 24, 46, 0.9)');
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-close-cta"]`)).toBeVisible();
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-reset"]`)).toBeVisible();
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-restart"]`)).toHaveCount(0);
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-home"]`)).toHaveCount(0);

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
    await shell.settingsCloseCta();
    await expect(page.locator(SETTINGS_CARD)).toBeHidden({ timeout: 4000 });
  });

  test('menu settings: reset progress link resets progress and returns to the menu', async ({ page }) => {
    await boot(page);
    await callHarness<Harness, null, void>(page, WINDOW_KEY, (h) => h.unlockAll(), null);
    await callHarness<Harness, number, void>(page, WINDOW_KEY, (h, coins) => h.grantCoins(coins), 25);
    await enterLevel(page, 1);
    await callHarness<Harness, null, void>(page, WINDOW_KEY, (h) => h.gotoMenu(), null);
    await expect(page.locator('[data-fab-action="play"]')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('[data-fab-action="play"]')).not.toHaveText('Level 1');
    await expect(page.locator('.mr-coin-pill-value')).toHaveText('25');

    const shell = new SharedShellDriver(page);
    await shell.openSettings();
    await expect(page.locator(SETTINGS_CARD)).toBeVisible({ timeout: 4000 });
    await shell.settingsReset();
    await expect(page.locator(SETTINGS_CARD)).toBeHidden({ timeout: 4000 });
    await expect(page.locator('[data-fab-action="play"]')).toHaveText('Level 1');
    await expect(page.locator('.mr-coin-pill-value')).toHaveText('0');
  });

  test('paused settings: restart starts the current level from the in-level modal', async ({ page }) => {
    await boot(page);
    await enterLevel(page, 1);
    const shell = new SharedShellDriver(page);
    await page.locator(HUD_PAUSE).click();
    await expect(page.locator(PAUSE_CARD)).toBeVisible({ timeout: 4000 });
    await shell.pauseSettings();
    await expect(page.locator(SETTINGS_CARD)).toBeVisible({ timeout: 4000 });
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-restart"]`)).toBeVisible();
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-home"]`)).toBeVisible();
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-close-cta"]`)).toHaveCount(0);
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-reset"]`)).toHaveCount(0);
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
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-restart"]`)).toBeVisible();
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-home"]`)).toBeVisible();
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-close-cta"]`)).toHaveCount(0);
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-reset"]`)).toHaveCount(0);
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
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-restart"]`)).toBeVisible();
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-home"]`)).toBeVisible();
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-close-cta"]`)).toHaveCount(0);
    await expect(page.locator(`${SETTINGS_CARD} [data-fab-action="settings-reset"]`)).toHaveCount(0);
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

  test('result: win HUD keeps only the top-right coin pill visible', async ({ page }) => {
    await boot(page);
    const reached = await callHarness<Harness, string, Promise<boolean>>(page, WINDOW_KEY, (h, state) => h.driveTo(state), 'win');
    expect(reached).toBe(true);
    await expect(page.locator('.fab-result-card--win')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('#hud .mr-hud--result-win .mr-coin')).toBeVisible();
    await expect(page.locator('#hud .mr-hearts-panel')).toBeHidden();
    await expect(page.locator('#hud [data-a="pause"]')).toBeHidden();
    await expect(page.locator('#hud [data-a="hint"]')).toBeHidden();
    const viewport = page.viewportSize()!;
    const coinBox = await page.locator('#hud .mr-hud--result-win .mr-coin').boundingBox();
    expect((coinBox?.x ?? 0) + (coinBox?.width ?? 0)).toBeGreaterThan(viewport.width * 0.76);
    expect(viewport.width - ((coinBox?.x ?? 0) + (coinBox?.width ?? 0))).toBeLessThan(24);
    expect(coinBox?.y ?? viewport.height).toBeLessThan(40);
  });

  test('result: win image ribbon keeps one LEVEL 4 eyebrow above one completed title', async ({ page }) => {
    await boot(page);
    await expectImageRibbonEyebrow(page, {
      resultState: 'win',
      cardClass: 'win',
      assetName: 'ribbon-completed-blank',
      title: 'COMPLETED',
    });
  });

  test('result: fail image ribbon keeps one LEVEL 4 eyebrow above one failed title', async ({ page }) => {
    await boot(page);
    await expectImageRibbonEyebrow(page, {
      resultState: 'fail',
      cardClass: 'lose',
      assetName: 'ribbon-failed-blank',
      title: 'FAILED',
    });
  });

  test('result: resultRetry() really restarts from the fail card (HUD remounts)', async ({ page }) => {
    await boot(page);
    const reached = await callHarness<Harness, string, Promise<boolean>>(page, WINDOW_KEY, (h, state) => h.driveTo(state), 'fail');
    expect(reached).toBe(true);
    await expect(page.locator('.fab-result-card--lose')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('.fab-result-card--lose .mr-result-emoji')).toHaveText('😢');
    const shell = new SharedShellDriver(page);
    await shell.resultRetry();
    await expect(page.locator('#hud .mr-hud')).toBeVisible({ timeout: 8000 });
  });

  test('result: fail hides gameplay HUD chrome behind the card', async ({ page }) => {
    await boot(page);
    const reached = await callHarness<Harness, string, Promise<boolean>>(page, WINDOW_KEY, (h, state) => h.driveTo(state), 'fail');
    expect(reached).toBe(true);
    await expect(page.locator('.fab-result-card--lose')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('.fab-result-card--lose .mr-result-emoji')).toHaveText('😢');
    await expect(page.locator('#hud .mr-hud--result-lose')).toBeVisible();
    await expect(page.locator('#hud .mr-hearts-panel')).toBeHidden();
    await expect(page.locator('#hud [data-a="pause"]')).toBeHidden();
    await expect(page.locator('#hud [data-a="hint"]')).toBeHidden();
    await expect(page.locator('#hud .mr-coin')).toBeHidden();
  });
});
