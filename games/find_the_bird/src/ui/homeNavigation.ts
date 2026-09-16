import { openPage } from './HUD';
import { animateCoinsToBalance, animateHintsToBalance } from './EconomyTransfer';
import { gameState } from '../core/GameState';
import { analytics } from '../analytics/AnalyticsService';
import { refreshHomeWalletBalances } from './WalletBalances';
import { hapticWrong } from '../haptics/HapticsManager';

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
/**
 * Locked nav tile tapped: roll-shake the tile and fire the "wrong" haptic. No
 * navigation. Same restart/listener guard as triggerNavBounce, since rapid
 * re-taps cancel the in-flight animation and animationend never fires.
 */
export function shakeLockedNavButton(button: HTMLButtonElement): void {
  hapticWrong();
  button.classList.remove('home-nav-btn--shake');
  void button.offsetWidth;
  button.classList.add('home-nav-btn--shake');
  const prev = (button as HTMLButtonElement & { __shakeEnd?: () => void }).__shakeEnd;
  if (prev !== undefined) button.removeEventListener('animationend', prev);
  const onEnd = (): void => { button.classList.remove('home-nav-btn--shake'); };
  (button as HTMLButtonElement & { __shakeEnd?: () => void }).__shakeEnd = onEnd;
  button.addEventListener('animationend', onEnd, { once: true });
}

export function bindHomeNavigation(overlay: HTMLElement, deps: HomeNavigationDeps): void {
  const open = deps.openPage ?? openPage;

  for (const locked of overlay.querySelectorAll<HTMLButtonElement>('.home-nav-btn--locked')) {
    locked.addEventListener('click', (e) => {
      e.preventDefault();
      if (document.getElementById('home-page-overlay')) return;
      shakeLockedNavButton(e.currentTarget as HTMLButtonElement);
    });
  }

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
  // Home No Ads badge: straight into the Remove Ads purchase (shop opens
  // behind the native sheet so a cancel lands somewhere sensible).
  overlay.querySelector<HTMLButtonElement>('#home-no-ads')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.getElementById('home-page-overlay')) return;
    deps.triggerNavBounce(e.currentTarget as HTMLButtonElement);
    open('shop', { scrollTo: 'entitlements', purchase: 'no-ads' });
  });

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
    // The claim affordance is computed at RENDER time, so a claim that mutates
    // the pill in place must also retire the dot and the bounce — otherwise
    // they keep insisting there is something to collect until the next full
    // home render (2026-08-07).
    button.classList.remove('home-claim-attention');
    button.querySelector('.home-claim-dot')?.remove();
    const badge = button.querySelector('small');
    if (badge) badge.textContent = '✓';
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
