import { openPage } from './HUD';
import { animateCoinsToBalance, animateHintsToBalance } from './EconomyTransfer';
import { gameState } from '../core/GameState';
import { analytics } from '../analytics/AnalyticsService';
import { refreshHomeWalletBalances } from './WalletBalances';

export interface HomeNavigationDeps {
  /** Tap feedback on the pressed button (bounce animation). */
  triggerNavBounce(button: HTMLButtonElement): void;
  /** Start the current level from Play Now. */
  startCurrentLevel(button: HTMLButtonElement): void;
  /** Page opener — injectable so tests can observe routing. */
  openPage?: typeof openPage;
}

/**
 * Wire the home overlay's navigation: page buttons (settings / shop /
 * achievements), the shop deep-link shortcuts, and the Play Now trigger.
 * Pure DOM — extracted from HomeScene so routing is click-testable without
 * a Phaser scene.
 */
export function bindHomeNavigation(overlay: HTMLElement, deps: HomeNavigationDeps): void {
  const open = deps.openPage ?? openPage;

  const pageButtons: Array<[string, 'settings' | 'shop' | 'achievements']> = [
    ['#home-nav-settings', 'settings'],
    ['#home-nav-shop', 'shop'],
    ['#home-nav-achievements', 'achievements'],
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
  ];
  for (const [id, scrollTo] of shopShortcuts) {
    overlay.querySelector<HTMLButtonElement>(id)?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (document.getElementById('home-page-overlay')) return;
      deps.triggerNavBounce(e.currentTarget as HTMLButtonElement);
      open('shop', { scrollTo });
    });
  }

  overlay.querySelector<HTMLButtonElement>('#home-streak-reward')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (button.dataset.rewardStatus !== 'claimable') return;
    deps.triggerNavBounce(button);
    const claim = (() => {
      try {
        return gameState.claimDailyStreakReward();
      } catch {
        return gameState.claimDailyStreakReward();
      }
    })();
    if (!claim) return;
    if (claim.coins > 0) void analytics.resourceChanged({
      flow_type: 'source', currency: 'coins', amount: claim.coins,
      item_type: 'rewarded', item_id: 'daily_streak',
    });
    if (claim.hints > 0) void analytics.resourceChanged({
      flow_type: 'source', currency: 'hints', amount: claim.hints,
      item_type: 'rewarded', item_id: 'daily_streak',
    });
    button.dataset.rewardStatus = 'claimed';
    button.querySelector('small')!.textContent = '✓';
    button.setAttribute('aria-label', `${claim.streakDay}-day play streak. Today’s reward collected`);
    // Fly the granted coins/hints from the streak pill to the wallet pills;
    // the transfer animation updates the counters as tokens land.
    const wallet = { coins: gameState.coinBalance, hints: gameState.hintsRemaining };
    if (claim.coins > 0) {
      void animateCoinsToBalance({
        amount: claim.coins,
        source: button,
        target: overlay.querySelector<HTMLElement>('.home-coin-pill'),
        owner: overlay,
        countElement: overlay.querySelector<HTMLElement>('.home-coin-pill > span'),
        fromValue: wallet.coins - claim.coins,
        toValue: wallet.coins,
      });
    }
    if (claim.hints > 0) {
      void animateHintsToBalance({
        amount: claim.hints,
        source: button,
        target: overlay.querySelector<HTMLElement>('.home-hint-pill'),
        owner: overlay,
        countElement: overlay.querySelector<HTMLElement>('.home-hint-pill > span'),
        fromValue: wallet.hints - claim.hints,
        toValue: wallet.hints,
      });
    }
    refreshHomeWalletBalances(overlay);
  });

  overlay.querySelector<HTMLButtonElement>('#home-play-now')?.addEventListener('click', (e) => {
    deps.startCurrentLevel(e.currentTarget as HTMLButtonElement);
  });
}
