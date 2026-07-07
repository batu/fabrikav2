/**
 * SharedShellDriver — page objects over the `packages/ui` stable `data-fab-*`
 * hooks, covering menu / settings / shop / result / pause navigation for EVERY
 * game. Built on the same real-actionability principle as marble_run's
 * `menu-clicks.spec.ts`: it drives real DOM clicks through hook SELECTORS (no
 * harness shortcut, no `force`), so an intercepting overlay makes a navigation
 * FAIL rather than silently no-op — the dead-menu-buttons guarantee.
 *
 * Structurally typed against Playwright's `Page` ({@link ShellPage}) so a test
 * passes its real `page`, but this file imports NOTHING from `@playwright/test`
 * (mirrors `harness.ts`) — the driver is a thin selector map, not a runner.
 *
 * The hook NAMES here are the portfolio convention. `data-fab-action="play"`,
 * `"settings"`, `"shop"` already exist (HomeMenu). The pause/result/back hooks
 * are added additively to the shared `ui` components in this same card; a game
 * that composes those components gets the navigation for free.
 */

/** The minimal Playwright `Locator` surface the driver uses. */
export interface ShellLocator {
  click(options?: { timeout?: number }): Promise<void>;
  isVisible(): Promise<boolean>;
  waitFor(options?: { state?: 'visible' | 'hidden'; timeout?: number }): Promise<void>;
}

/** The minimal Playwright `Page` surface the driver uses. */
export interface ShellPage {
  locator(selector: string): ShellLocator;
}

/**
 * Canonical `data-fab-*` hook values — the ONE source of truth for the shell
 * navigation surface. Games (and the audit hook-check) reference these so a
 * driver method and the attribute it targets can't drift.
 */
export const SHELL_HOOKS = {
  /** HomeMenu primary actions (already emitted by HomeMenu today). */
  menu: { play: 'play', settings: 'settings', shop: 'shop' },
  /** PauseOverlay actions (added additively to PauseOverlay). */
  pause: { resume: 'pause-resume', settings: 'pause-settings', quit: 'pause-quit' },
  /** ResultCard actions (consumer sets these on the injected ModalActions). */
  result: { next: 'result-next', retry: 'result-retry', menu: 'result-menu' },
  /** Settings modal actions. */
  settings: { close: 'settings-close', restart: 'settings-restart', home: 'settings-home' },
  /** PageShell back button (added additively to PageShell). */
  back: 'back',
  /** ShopPage restore control (added additively to ShopPage). */
  shopRestore: 'shop-restore',
} as const;

/** Selector for a `data-fab-action` value. */
export function fabAction(action: string): string {
  return `[data-fab-action="${action}"]`;
}

/** Selector for a `data-fab-toggle-key` row (ToggleRow already emits this). */
export function fabToggle(key: string): string {
  return `[data-fab-toggle-key="${key}"]`;
}

/**
 * A page object over the shared shell. One instance per test wraps the `page`;
 * every method drives a real click through a hook selector. Callers assert the
 * resulting DOM effect themselves (the driver navigates; it does not assert).
 */
export class SharedShellDriver {
  constructor(private readonly page: ShellPage) {}

  /** Locate a `data-fab-action` element (escape hatch for game-specific hooks). */
  action(name: string): ShellLocator {
    return this.page.locator(fabAction(name));
  }

  // ── menu ─────────────────────────────────────────────────────────
  play(): Promise<void> {
    return this.action(SHELL_HOOKS.menu.play).click();
  }
  openSettings(): Promise<void> {
    return this.action(SHELL_HOOKS.menu.settings).click();
  }
  openShop(): Promise<void> {
    return this.action(SHELL_HOOKS.menu.shop).click();
  }

  // ── pause ────────────────────────────────────────────────────────
  pauseResume(): Promise<void> {
    return this.action(SHELL_HOOKS.pause.resume).click();
  }
  pauseSettings(): Promise<void> {
    return this.action(SHELL_HOOKS.pause.settings).click();
  }
  pauseQuit(): Promise<void> {
    return this.action(SHELL_HOOKS.pause.quit).click();
  }

  // ── result ───────────────────────────────────────────────────────
  resultNext(): Promise<void> {
    return this.action(SHELL_HOOKS.result.next).click();
  }
  resultRetry(): Promise<void> {
    return this.action(SHELL_HOOKS.result.retry).click();
  }
  resultMenu(): Promise<void> {
    return this.action(SHELL_HOOKS.result.menu).click();
  }

  // ── settings / shop / back ───────────────────────────────────────
  /** Toggle a settings row by its stable key (music/sfx/haptics/...). */
  toggle(key: string): Promise<void> {
    return this.page.locator(`${fabToggle(key)} .fab-toggle-input`).click();
  }
  settingsClose(): Promise<void> {
    return this.action(SHELL_HOOKS.settings.close).click();
  }
  settingsRestart(): Promise<void> {
    return this.action(SHELL_HOOKS.settings.restart).click();
  }
  settingsHome(): Promise<void> {
    return this.action(SHELL_HOOKS.settings.home).click();
  }
  restorePurchases(): Promise<void> {
    return this.action(SHELL_HOOKS.shopRestore).click();
  }
  /** Dismiss the current page (PageShell back button). */
  back(): Promise<void> {
    return this.action(SHELL_HOOKS.back).click();
  }
}
