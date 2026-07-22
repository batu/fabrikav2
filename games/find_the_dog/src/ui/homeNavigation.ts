import { openPage } from './HUD';

export interface HomeNavigationDeps {
  /** Tap feedback on the pressed button (bounce animation). */
  triggerNavBounce(button: HTMLButtonElement): void;
  /** Start the current level (Play Now / Play tab). */
  startCurrentLevel(button: HTMLButtonElement): void;
  /** Page opener — injectable so tests can observe routing. */
  openPage?: typeof openPage;
}

/**
 * Wire the home overlay's navigation: page buttons (settings / shop /
 * achievements), the shop deep-link shortcuts, and the two play triggers.
 * Pure DOM — extracted from HomeScene so routing is click-testable without
 * a Phaser scene.
 */
export function bindHomeNavigation(overlay: HTMLElement, deps: HomeNavigationDeps): void {
  const open = deps.openPage ?? openPage;

  const pageButtons: Array<[string, 'settings' | 'shop' | 'achievements']> = [
    ['#home-nav-settings', 'settings'],
    ['#home-nav-shop', 'shop'],
    ['#home-achievements', 'achievements'],
  ];
  for (const [id, page] of pageButtons) {
    overlay.querySelector<HTMLButtonElement>(id)?.addEventListener('click', (e) => {
      if (document.getElementById('home-page-overlay')) return;
      deps.triggerNavBounce(e.currentTarget as HTMLButtonElement);
      open(page);
    });
  }

  // Currency "+" pills and the No-Ads button route into the shop — each deep-
  // links to its own section (coins / hints / entitlements).
  const shopShortcuts: Array<[string, 'coins' | 'hints' | 'entitlements']> = [
    ['#home-coin-plus', 'coins'],
    ['#home-hint-plus', 'hints'],
    ['#home-no-ads', 'entitlements'],
  ];
  for (const [id, scrollTo] of shopShortcuts) {
    overlay.querySelector<HTMLButtonElement>(id)?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (document.getElementById('home-page-overlay')) return;
      deps.triggerNavBounce(e.currentTarget as HTMLButtonElement);
      open('shop', { scrollTo });
    });
  }

  overlay.querySelector<HTMLButtonElement>('#home-play-now')?.addEventListener('click', (e) => {
    deps.startCurrentLevel(e.currentTarget as HTMLButtonElement);
  });
  overlay.querySelector<HTMLButtonElement>('#home-nav-play')?.addEventListener('click', (e) => {
    deps.startCurrentLevel(e.currentTarget as HTMLButtonElement);
  });
}
