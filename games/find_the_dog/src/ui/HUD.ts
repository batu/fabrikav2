import { gameState } from '../core/GameState';
import { GAMEPLAY } from '../core/Constants';
import { playUITap, playHint, setMusicEnabled, setSoundEffectsEnabled } from '../audio/AudioManager';
import { syncAmbientMusicPreference } from '../audio/AmbientManager';
import { analytics } from '../analytics/AnalyticsService';
import { trackRewardedWatchedAfterGrant } from '../attribution/RewardedAttribution';
import { adService, showRewardedAdForEconomy } from '../ads/Service';
import { iapService, type IapRestoreResult, type IapServiceState, type IapSnapshot, type IapStoreProductSnapshot } from '../shop/IapService';
import { buildHintBoosterOffers } from '../shop/HintBoosterOffers';
import { buildFullShopCatalog, buildShopCatalog, type ShopCatalogProduct } from '../shop/ProductCatalog';
import { fulfillVerifiedPurchaseOnce, makePurchaseRestoreRetry, reportUnfulfilledPurchase, restoreNonConsumableEntitlements } from '../shop/PurchaseFulfillment';
import { animateHintsToBalance } from './EconomyTransfer';
import { getLegalLinks, type LegalLinks } from '../platform/LegalLinks';
import { privacyConsentService } from '../privacy/PrivacyConsentService';
import { rewardedAdIconMarkup } from './RewardedAdIcon';
import { hideHomeMenuLayer } from './OverlayVisibility';

let hintCallback: (() => void) | null = null;

/** Kick a rewarded-ad preload in the background so the first "watch-ad for hint" tap is quick. */
function schedulePreloadIfRewardedPathAvailable(): void {
  if (gameState.isRewardedHintCapped()) return;
  if (!gameState.settings.adsEnabled) return;
  void adService.preloadRewarded();
}

/**
 * Remember the total-dogs count between HUD updates so the async rewarded
 * handler can re-render without a parameter. Singleton HUD matches a
 * singleton gameState; if two concurrent GameScenes ever exist they'd
 * also stomp each other elsewhere.
 */
let lastKnownTotalDogs = 0;
let lastKnownRestorationActive = false;

type RestoreUiState = 'idle' | 'initializing' | 'busy' | 'unavailable' | 'pending' | 'restored' | 'empty' | 'failed';

const IAP_CONTROL_REFRESH_MS = 250;

let restoreUiState: RestoreUiState = 'idle';
let activeRestorePromise: Promise<RestoreUiState> | null = null;
let awaitingLateRestoreResult = false;
let lateRestorePollScheduled = false;
let shopNativeOperationRefreshScheduledFor: HTMLElement | null = null;

function openExternalUrl(url: string): void {
  window.open(url, '_system');
}

function openLegalLink(key: keyof LegalLinks): void {
  const links = getLegalLinks();
  openExternalUrl(links[key]);
}

/** Handle a tap on the hint button when hintsRemaining === 0 but a rewarded ad is available. */
async function handleRewardedHintTap(hintBtn: HTMLButtonElement): Promise<void> {
  if (hintBtn.dataset.pending === '1') return;
  hintBtn.dataset.pending = '1';
  const originalLabel = hintBtn.innerHTML;
  hintBtn.innerHTML = `${rewardedAdIconMarkup('hint-booster-ad-icon')}<span class="hint-booster-action-copy"><span>Loading...</span><small>Opening ad</small></span>`;
  hintBtn.disabled = true;
  try {
    const { granted } = await showRewardedAdForEconomy();
    if (granted) {
      const source = document.getElementById('hint-booster-watch-ad') ?? hintBtn;
      const hintGranted = trackRewardedWatchedAfterGrant(
        { granted },
        'hint_button',
        () => gameState.grantRewardedHint(),
      );
      if (!hintGranted) return;
      playHint();
      void animateHintsToBalance({ amount: 1, source });
      void analytics.rewardedAdGranted({ placement: 'hint_button' });
      void analytics.resourceChanged({
        flow_type: 'source',
        currency: 'hints',
        amount: 1,
        item_type: 'rewarded',
        item_id: 'rewarded_hint',
      });
      hintCallback?.();
      void analytics.settingsChanged({ setting_name: 'rewardedHintGranted', new_value: String(gameState.rewardedHintsToday) });
    }
  } finally {
    delete hintBtn.dataset.pending;
    hintBtn.innerHTML = originalLabel;
    updateHUD(lastKnownTotalDogs, lastKnownRestorationActive);
    // Preload the next one so a rapid second earn is still fast.
    schedulePreloadIfRewardedPathAvailable();
  }
}

export function initHUD(): void {
  const overlay = document.getElementById('hud-overlay');
  if (!overlay) return;

  hideHomeMenuLayer(overlay);
  overlay.innerHTML = `
    <div class="hud-top-bar">
      <div class="hud-left">
        <div id="dog-counter" class="hud-pill">🐾 <span class="count">0/0</span></div>
        <div id="hearts" class="hud-pill" aria-label="Lives"></div>
      </div>
      <div class="hud-right">
        <div id="coin-pill" class="hud-pill" data-economy-target="coins" aria-label="Coin balance">
          <img class="hud-pill-icon" src="/ui/menu-icons/icon_coin.png" alt="" aria-hidden="true" data-economy-anchor="coin">
          <span class="coin-count">${gameState.coinBalance}</span>
          <button id="hud-coin-plus" class="home-pill-plus" type="button" aria-label="Buy more coins">+</button>
        </div>
        <button id="settings-btn" type="button" aria-label="Settings">
          <img class="hud-icon-img" src="/ui/menu-icons/icon_settings_gear.png" alt="" aria-hidden="true">
        </button>
      </div>
    </div>
    <div id="offline-indicator" class="offline-indicator hidden" aria-label="Offline — playing cached levels" role="status">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="currentColor" d="M19.35 10.04A7.49 7.49 0 0 0 12 4c-2.65 0-4.96 1.38-6.32 3.45l1.43 1.43A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 5.45 4.78l.2 1.45l1.46.11A2.5 2.5 0 0 1 21.5 15c0 1.1-.72 2.04-1.71 2.38l1.43 1.43A4.5 4.5 0 0 0 23 15a4.5 4.5 0 0 0-3.65-4.96zM3.71 3.12L2.29 4.54l2.1 2.1A6.01 6.01 0 0 0 1 12c0 2.45 1.47 4.55 3.58 5.48c.32.14.66.25 1.01.33L18.46 20.71l1.42-1.42z"/>
      </svg>
    </div>
    <div class="hud-hint-wrap">
      <button id="hint-btn" class="hud-pill" data-economy-target="hints" type="button">
        <img class="hud-pill-icon" src="/ui/menu-icons/icon_hint_magnifier.png" alt="" aria-hidden="true" data-economy-anchor="hint">
        <span class="hint-count">${gameState.hintsRemaining}</span>
      </button>
      <button id="hud-hint-plus" class="home-pill-plus hud-hint-plus" type="button" aria-label="Buy more hints" hidden>+</button>
    </div>
  `;

  initConnectivityIndicator();

  const hintBtn = document.getElementById('hint-btn') as HTMLButtonElement | null;
  hintBtn?.addEventListener('click', () => {
    playUITap();
    if (gameState.hintCircleActive) return;
    if (gameState.hintsRemaining > 0) {
      playHint();
      hintCallback?.();
      return;
    }
    showHintBoosterModal();
  });

  schedulePreloadIfRewardedPathAvailable();

  const settingsBtn = document.getElementById('settings-btn');
  settingsBtn?.addEventListener('click', () => {
    playUITap();
    openPage('settings');
  });

  // Currency top-up "+" badges: open the new full-screen shop page deep-linked
  // to the relevant section (mirrors the home-menu currency pluses). openPage
  // already guards against stacking a second page overlay.
  const coinPlus = document.getElementById('hud-coin-plus');
  coinPlus?.addEventListener('click', () => {
    playUITap();
    openPage('shop', { scrollTo: 'coins' });
  });

  const hintPlus = document.getElementById('hud-hint-plus');
  hintPlus?.addEventListener('click', () => {
    playUITap();
    openPage('shop', { scrollTo: 'hints' });
  });
}

export function setHintCallback(cb: () => void): void {
  hintCallback = cb;
}

export function setDebugOverlayCallback(_cb: (on: boolean) => void): void {
  // Kept for copied scene compatibility; the v2 HUD no longer owns debug overlay state.
}

export function setLevelSelectCallback(_cb: (levelId: string) => void): void {
  // Kept for copied scene compatibility; level selection is owned by the home saga rail.
}

export function setHomeCallback(_cb: (() => void) | null): void {
  // Kept for copied scene compatibility; HomeScene owns home re-rendering directly.
}

/** Restart the active level when Classic / Restoration toggles in settings. */
export function setGameModeChangeCallback(_cb: (() => void) | null): void {
  // Kept for copied scene compatibility; GameScene explicitly restarts when needed.
}

export function updateHUD(totalDogs: number, restorationActive: boolean = false): void {
  lastKnownTotalDogs = totalDogs;
  lastKnownRestorationActive = restorationActive;

  // Dog counter
  const countEl = document.querySelector('#dog-counter .count');
  if (countEl) countEl.textContent = `${gameState.foundDogIds.size}/${totalDogs}`;

  const coinCount = document.querySelector('#coin-pill .coin-count');
  if (coinCount) coinCount.textContent = String(gameState.coinBalance);

  // Hearts
  const heartsEl = document.getElementById('hearts');
  if (heartsEl) {
    const hearts: string[] = [];
    for (let i = 0; i < GAMEPLAY.LIVES_PER_LEVEL; i++) {
      if (i < gameState.lives) {
        hearts.push('<span class="heart-icon" aria-hidden="true"></span>');
      } else {
        hearts.push('<span class="heart-icon empty" aria-hidden="true"></span>');
      }
    }
    heartsEl.innerHTML = hearts.join('');
  }

  updateRestorationProgress(totalDogs, restorationActive);

  // Streak badge is temporarily removed from the HUD so the right-side
  // controls fit beside the coin pill on narrow mobile screens.

  // Hint button — two visual states:
  //   hintsRemaining > 0: normal "💡 N"
  //   hintsRemaining === 0: opens the hint booster modal.
  const hintBtn = document.getElementById('hint-btn') as HTMLButtonElement | null;
  if (hintBtn) {
    const hasHints = gameState.hintsRemaining > 0;
    // The hint top-up "+" only appears when out of hints, so during normal play
    // its tap target can't overlap / steal taps from the hint button or canvas.
    const hintPlus = document.getElementById('hud-hint-plus');
    if (hintPlus) hintPlus.hidden = hasHints;
    if (hasHints) {
      hintBtn.innerHTML = `<img class="hud-pill-icon" src="/ui/menu-icons/icon_hint_magnifier.png" alt="" aria-hidden="true" data-economy-anchor="hint"><span class="hint-count">${gameState.hintsRemaining}</span>`;
      hintBtn.disabled = gameState.hintCircleActive;
      hintBtn.classList.toggle('pulse', !gameState.hintCircleActive);
    } else {
      hintBtn.innerHTML = '<img class="hud-pill-icon" src="/ui/menu-icons/icon_hint_magnifier.png" alt="" aria-hidden="true" data-economy-anchor="hint"><span class="hint-count">0</span>';
      hintBtn.disabled = gameState.hintCircleActive;
      hintBtn.classList.remove('pulse');
    }
  }
}

/**
 * Play a one-shot playful "lost" wiggle on the heart that just emptied.
 * Call immediately AFTER updateHUD() on an actual life loss — updateHUD rebuilds
 * the hearts row, so the freshly-rendered pip at index `gameState.lives` (the
 * first empty slot) is the one that was just spent. The CSS class is cleared
 * naturally on the next updateHUD rebuild.
 */
export function animateLifeLost(): void {
  const heartsEl = document.getElementById('hearts');
  if (!heartsEl) return;
  const pips = heartsEl.querySelectorAll<HTMLElement>('.heart-icon');
  // lives was already decremented by the caller; the just-emptied pip is the
  // first empty one, at index === remaining lives. The DOM lib types index
  // access as non-optional, so cast to surface the genuine out-of-bounds case
  // (no-op for a purely cosmetic animation) the `?.` below handles.
  const justLost = pips[gameState.lives] as HTMLElement | undefined;
  justLost?.classList.add('heart-lost');
}

function showHintBoosterModal(): void {
  const overlay = document.getElementById('hud-overlay');
  if (!overlay || document.getElementById('hint-booster-modal')) return;

  const offers = buildHintBoosterOffers({
    hints: gameState.hintsRemaining,
    coins: gameState.coinBalance,
    adsEnabled: gameState.settings.adsEnabled,
    hasNoAdsEntitlement: gameState.hasNoAdsEntitlement,
    rewardedAdAvailable: !gameState.isRewardedHintCapped(),
  });
  const bundle = offers.options.find((option) => option.kind === 'coinBundle');
  const coinSingle = offers.options.find((option) => option.kind === 'coinSingle');
  const rewardedAd = offers.options.find((option) => option.kind === 'rewardedAd');
  const shopTopUp = offers.options.find((option) => option.kind === 'shopTopUp');

  const modal = document.createElement('div');
  modal.id = 'hint-booster-modal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-card hint-booster-card" role="dialog" aria-modal="true" aria-labelledby="hint-booster-title">
      <h2 id="hint-booster-title">Out of hints?</h2>
      <p class="hint-booster-copy">Get a fresh hint pack and use one right away.</p>
      <div class="hint-booster-balance">
        <img class="hud-inline-icon" src="/ui/menu-icons/icon_coin.png" alt="" aria-hidden="true">
        <span id="hint-booster-coin-balance">${gameState.coinBalance}</span> coins
      </div>
      <div class="hint-booster-actions">
        ${bundle ? `
          <button id="hint-booster-buy-bundle" class="hint-booster-primary" type="button" ${bundle.status === 'available' ? '' : 'disabled'}>
            Get ${bundle.hintAmount} hints — ${bundle.coinPrice} coins
          </button>
        ` : ''}
        ${rewardedAd ? `
          <button id="hint-booster-watch-ad" class="hint-booster-secondary rewarded-ad-button" type="button" ${rewardedAd.status === 'available' ? '' : 'disabled'}>
            ${rewardedAdIconMarkup('hint-booster-ad-icon')}
            <span class="hint-booster-action-copy">
              <span>Watch Ad</span>
              <small>+${rewardedAd.hintAmount} hint</small>
            </span>
          </button>
        ` : ''}
        ${coinSingle ? `
          <button id="hint-booster-buy-single" class="hint-booster-secondary" type="button" ${coinSingle.status === 'available' ? '' : 'disabled'}>
            Buy 1 hint — ${coinSingle.coinPrice} coins
          </button>
        ` : ''}
        ${shopTopUp ? `
          <button id="hint-booster-shop" class="hint-booster-secondary" type="button">
            Visit shop / top up
          </button>
        ` : ''}
      </div>
      ${bundle?.status === 'insufficientCoins' && coinSingle?.status !== 'available' ? '<p class="hint-booster-note">Not enough coins for the 3-hint booster.</p>' : ''}
      <button id="hint-booster-close" class="hint-booster-close" type="button">Maybe later</button>
    </div>
  `;

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeHintBoosterModal();
  });
  modal.querySelector('#hint-booster-close')?.addEventListener('click', closeHintBoosterModal);
  modal.querySelector('#hint-booster-buy-bundle')?.addEventListener('click', () => {
    if (!bundle || bundle.status !== 'available') return;
    const spent = gameState.spendCoins(bundle.coinPrice, 'shop');
    if (!spent) {
      updateHUD(lastKnownTotalDogs, lastKnownRestorationActive);
      return;
    }
    const hintsGranted = gameState.grantHints(bundle.hintAmount, 'shop');
    void analytics.resourceChanged({
      flow_type: 'sink',
      currency: 'coins',
      amount: bundle.coinPrice,
      item_type: 'hint',
      item_id: 'hint_booster_bundle',
    });
    void analytics.resourceChanged({
      flow_type: 'source',
      currency: 'hints',
      amount: hintsGranted,
      item_type: 'shop',
      item_id: 'hint_booster_bundle',
    });
    if (hintsGranted > 0) {
      void animateHintsToBalance({ amount: hintsGranted, source: modal.querySelector('#hint-booster-buy-bundle') });
    }
    closeHintBoosterModal();
    playHint();
    hintCallback?.();
    updateHUD(lastKnownTotalDogs, lastKnownRestorationActive);
  });
  modal.querySelector('#hint-booster-buy-single')?.addEventListener('click', () => {
    if (!coinSingle || coinSingle.status !== 'available') return;
    const spent = gameState.spendCoins(coinSingle.coinPrice, 'shop');
    if (!spent) {
      updateHUD(lastKnownTotalDogs, lastKnownRestorationActive);
      return;
    }
    const hintsGranted = gameState.grantHints(coinSingle.hintAmount, 'shop');
    void analytics.resourceChanged({
      flow_type: 'sink',
      currency: 'coins',
      amount: coinSingle.coinPrice,
      item_type: 'hint',
      item_id: 'hint_booster_single',
    });
    void analytics.resourceChanged({
      flow_type: 'source',
      currency: 'hints',
      amount: hintsGranted,
      item_type: 'shop',
      item_id: 'hint_booster_single',
    });
    if (hintsGranted > 0) {
      void animateHintsToBalance({ amount: hintsGranted, source: modal.querySelector('#hint-booster-buy-single') });
    }
    closeHintBoosterModal();
    playHint();
    hintCallback?.();
    updateHUD(lastKnownTotalDogs, lastKnownRestorationActive);
  });
  modal.querySelector('#hint-booster-watch-ad')?.addEventListener('click', () => {
    const button = modal.querySelector<HTMLButtonElement>('#hint-booster-watch-ad');
    if (!button || rewardedAd?.status !== 'available') return;
    void handleRewardedHintTap(button).finally(() => closeHintBoosterModal());
  });
  modal.querySelector('#hint-booster-shop')?.addEventListener('click', () => {
    closeHintBoosterModal();
    openPage('shop', { scrollTo: 'hints' });
  });

  overlay.appendChild(modal);
}

function closeHintBoosterModal(): void {
  document.getElementById('hint-booster-modal')?.remove();
}

function updateRestorationProgress(_totalDogs: number, _restorationActive: boolean): void {
  document.getElementById('restoration-progress')?.remove();
}

// ── Phase 1: Full-screen slide-in page shell ──────────────────────

export function openPage(
  id: 'shop' | 'settings',
  opts: { scrollTo?: 'hints' | 'coins' | 'entitlements' } = {},
): void {
  const overlay = document.getElementById('hud-overlay');
  if (!overlay) return;
  const existing = document.getElementById('home-page-overlay');
  if (existing) {
    // A fully-open page is left as-is (ignore the duplicate open). But a page
    // mid-close still occupies the id for the ~420ms close animation — tear it
    // down synchronously so a fast back-then-tap reopen isn't swallowed.
    if (existing.classList.contains('home-page-overlay--open')) return;
    existing.remove();
  }

  const shell = overlay.querySelector<HTMLElement>('#home-shell');
  shell?.classList.add('home-shell--dimmed');

  const page = document.createElement('div');
  page.id = 'home-page-overlay';
  page.className = 'home-page-overlay';
  const title = id === 'shop' ? 'Shop' : 'Settings';
  page.innerHTML = `
    <div class="home-page-header">
      <button id="home-page-back" class="home-page-back-btn" type="button" aria-label="Go back">
        <img class="home-page-back-art" src="/ui/page-header/back_button.png" alt="" aria-hidden="true">
      </button>
      <h2 class="home-page-title">${title}</h2>
      ${id === 'shop' ? renderShopHeaderBalances() : ''}
    </div>
    <div class="home-page-body">
      ${id === 'shop' ? renderShopPageBody() : renderSettingsPageBody()}
    </div>
  `;

  page.querySelector('#home-page-back')?.addEventListener('click', () => {
    playUITap();
    closePage();
  });

  let touchStartY = 0;
  let touchStartedInScrollableBody = false;
  page.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
    touchStartedInScrollableBody = e.target instanceof Element && e.target.closest('.home-page-body') !== null;
  }, { passive: true });
  page.addEventListener('touchend', (e) => {
    if (id === 'shop' && touchStartedInScrollableBody) return;
    if (e.changedTouches[0].clientY - touchStartY >= 80) closePage();
  }, { passive: true });

  if (id === 'settings') {
    page.classList.add('home-page-settings');
    wireSettingsPageListeners(page);
  }
  if (id === 'shop') page.classList.add('home-page-shop');
  // Deep-link opens jump to a section, so skip the staggered content entrance
  // (otherwise the scrolled-to section sits empty then pops in after its delay).
  if (opts.scrollTo) page.classList.add('home-page-overlay--instant');

  overlay.appendChild(page);
  if (id === 'shop') {
    renderPageShopProducts(page);
    configureRestorePurchasesControl(page);
    schedulePageShopProductsRefresh(page);
    if (opts.scrollTo) {
      // Deep-link: jump the shop straight to the requested section (the home
      // "+" buttons open coins/hints directly).
      const body = page.querySelector<HTMLElement>('.home-page-body');
      const target = page.querySelector<HTMLElement>(`#shop-page-${opts.scrollTo}`);
      if (body && target) {
        requestAnimationFrame(() => {
          const top = target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
          body.scrollTo({ top: Math.max(0, top - 10) });
        });
      }
    }
  }
  requestAnimationFrame(() => { page.classList.add('home-page-overlay--open'); });
}

export function closePage(): void {
  const page = document.getElementById('home-page-overlay');
  if (!page) return;
  const overlay = document.getElementById('hud-overlay');
  overlay?.querySelector<HTMLElement>('#home-shell')?.classList.remove('home-shell--dimmed');
  page.classList.remove('home-page-overlay--open'); // slides back DOWN + fades, mirroring the open
  const remove = (): void => {
    page.removeEventListener('transitionend', onTransitionEnd);
    if (page.isConnected) page.remove();
  };
  // Tear down only once the slide-down (transform) finishes — NOT the faster
  // opacity fade — otherwise the exit animation is cut short.
  const onTransitionEnd = (e: TransitionEvent): void => {
    if (e.target === page && e.propertyName === 'transform') remove();
  };
  page.addEventListener('transitionend', onTransitionEnd);
  // Fallback: transform transition is 340ms; +80ms buffer for transitionend latency.
  window.setTimeout(remove, 420);
}

function renderShopHeaderBalances(): string {
  const wallet = gameState.walletSnapshot();
  return `
    <div class="shop-header-balances" aria-label="Shop currency balances">
      <div class="shop-header-balance-pill shop-header-coin-pill" data-economy-target="coins" aria-label="Coin balance">
        <img src="/ui/menu-icons/icon_coin.png" alt="" aria-hidden="true" data-economy-anchor="coin">
        <span class="shop-header-coin-count">${wallet.coins}</span>
      </div>
      <div class="shop-header-balance-pill shop-header-hint-pill" data-economy-target="hints" aria-label="Hint balance">
        <img src="/ui/menu-icons/icon_hint_magnifier.png" alt="" aria-hidden="true" data-economy-anchor="hint">
        <span class="shop-header-hint-count">${wallet.hints}</span>
      </div>
    </div>
  `;
}

function updateShopHeaderBalances(root: ParentNode = document): void {
  const wallet = gameState.walletSnapshot();
  const coinCount = root.querySelector<HTMLElement>('.shop-header-coin-count');
  const hintCount = root.querySelector<HTMLElement>('.shop-header-hint-count');
  if (coinCount !== null) coinCount.textContent = String(wallet.coins);
  if (hintCount !== null) hintCount.textContent = String(wallet.hints);
}

function renderShopPageBody(): string {
  return `
    <div class="shop-featured-section" id="shop-page-entitlements"></div>
    <div class="shop-new-section" id="shop-page-hints">
      <div class="shop-new-section-header">Hint Packs</div>
      <div class="shop-new-grid" id="shop-hints-grid"></div>
    </div>
    <div class="shop-new-section" id="shop-page-coins">
      <div class="shop-new-section-header">Coin Packs</div>
      <div class="shop-new-grid" id="shop-coins-grid"></div>
    </div>
    <div class="shop-restore-footer" id="shop-page-restore-footer">
      <div class="shop-restore-panel" id="shop-restore-panel">
        <div class="shop-restore-copy">
          <strong>Restore Purchases</strong>
          <small id="shop-restore-status">Restore No Ads purchases on this device.</small>
        </div>
        <button id="shop-restore-btn" class="btn-secondary shop-restore-btn" type="button">Restore</button>
      </div>
    </div>
  `;
}

function shopPackIconSrc(product: ShopCatalogProduct): string {
  if (product.kind === 'hintPack') {
    if (product.hintAmount <= 10) return '/ui/shop/shop_hint_pack_small.png';
    if (product.hintAmount <= 25) return '/ui/shop/shop_hint_pack_medium.png';
    return '/ui/shop/shop_hint_pack_large.png';
  }
  if (product.kind === 'coinPack') {
    if (product.coinAmount <= 1000) return '/ui/shop/shop_coin_pack_1.png';
    if (product.coinAmount <= 5000) return '/ui/shop/shop_coin_pack_2.png';
    if (product.coinAmount <= 10000) return '/ui/shop/shop_coin_pack_3.png';
    if (product.coinAmount <= 25000) return '/ui/shop/shop_coin_pack_4.png';
    if (product.coinAmount <= 50000) return '/ui/shop/shop_coin_pack_5.png';
    return '/ui/shop/shop_coin_pack_6.png';
  }
  return '/ui/shop/shop_vip_bundle.png';
}

function shopPackAmount(product: ShopCatalogProduct): string {
  if (product.kind === 'hintPack') return `${product.hintAmount} hints`;
  if (product.kind === 'coinPack') return product.coinAmount.toLocaleString('en-US');
  return '';
}

function renderFeaturedCard(
  product: ShopCatalogProduct,
  storeProduct: IapStoreProductSnapshot | null,
  iapSnapshot: IapSnapshot,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'shop-featured-wrapper';

  const card = document.createElement('div');
  const isVip = product.kind === 'noAdsPremium';
  card.className = `shop-featured-card ${isVip ? 'vip' : 'no-ads'}`;
  card.dataset.catalogId = product.id;

  const iconSrc = isVip ? '/ui/shop/shop_vip_bundle.png' : '/ui/shop/shop_no_ads.png';
  const badgeText = shopProductBadge(product);
  const price = storeProduct?.priceString ?? product.displayPrice;

  const iconEl = document.createElement('div');
  iconEl.className = 'shop-featured-icon';
  const img = document.createElement('img');
  img.src = iconSrc;
  img.alt = '';
  img.loading = 'eager';
  iconEl.appendChild(img);

  const copyEl = document.createElement('div');
  copyEl.className = 'shop-featured-copy';
  copyEl.innerHTML = `
    <div class="shop-featured-title">${product.title}</div>
    <div class="shop-featured-desc">${shopProductBenefit(product)}</div>
  `;

  const priceBtn = document.createElement('button');
  priceBtn.type = 'button';
  priceBtn.className = 'shop-featured-price-btn shop-purchase-btn';
  priceBtn.dataset.catalogId = product.id;
  applyShopPurchaseButtonState(
    product, priceBtn, iapSnapshot.state, storeProduct, price,
    iapSnapshot.nativeOperationInProgress, iapSnapshot.pendingPurchaseProductIds,
  );
  priceBtn.addEventListener('click', () => { void purchaseShopProduct(product, priceBtn, price); });

  card.appendChild(iconEl);
  card.appendChild(copyEl);
  card.appendChild(priceBtn);

  if (badgeText !== null) {
    const badge = document.createElement('div');
    const badgeKind = badgeText === 'Best Value' ? 'best-value' : 'one-time';
    badge.className = `shop-featured-badge shop-featured-badge--${badgeKind}`;
    badge.textContent = badgeText;
    wrapper.appendChild(badge);
  }

  wrapper.appendChild(card);
  return wrapper;
}

function renderGridCard(
  product: ShopCatalogProduct,
  storeProduct: IapStoreProductSnapshot | null,
  iapSnapshot: IapSnapshot,
  index: number,
  sectionClass?: string,
): HTMLElement {
  // Wrapper holds card + button as separate layers (reference layout)
  const wrapper = document.createElement('div');
  wrapper.className = 'shop-grid-wrapper';

  const card = document.createElement('div');
  const kindClass = product.kind === 'hintPack' ? 'shop-grid-card--hints' : 'shop-grid-card--coins';
  card.className = `shop-grid-card ${kindClass}`;
  card.dataset.catalogId = product.id;
  card.style.setProperty('--shine-delay', `${(index % 6) * 0.35}s`);

  const iconDiv = document.createElement('div');
  iconDiv.className = 'shop-grid-icon';
  const iconSrc = shopPackIconSrc(product);
  const img = document.createElement('img');
  img.src = iconSrc;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  iconDiv.style.setProperty('--icon-src', `url('${iconSrc}')`);
  iconDiv.appendChild(img);

  const amountEl = document.createElement('div');
  amountEl.className = 'shop-grid-amount';
  amountEl.textContent = shopPackAmount(product);

  const price = storeProduct?.priceString ?? product.displayPrice;
  const priceBtn = document.createElement('button');
  priceBtn.type = 'button';
  priceBtn.className = `shop-grid-price-btn shop-purchase-btn${sectionClass != null ? ` ${sectionClass}` : ''}`;
  priceBtn.dataset.catalogId = product.id;
  applyShopPurchaseButtonState(
    product, priceBtn, iapSnapshot.state, storeProduct, price,
    iapSnapshot.nativeOperationInProgress, iapSnapshot.pendingPurchaseProductIds,
  );
  priceBtn.addEventListener('click', () => { void purchaseShopProduct(product, priceBtn, price); });

  // Badge sits above the card as an absolute overlay
  const badgeText = shopProductBadge(product);
  if (badgeText !== null) {
    const badge = document.createElement('div');
    badge.className = `shop-grid-badge${badgeText === 'Best Value' ? ' best-value' : ''}`;
    badge.textContent = badgeText;
    wrapper.appendChild(badge);
  }

  const inner = document.createElement('div');
  inner.className = 'shop-grid-card-inner';
  inner.appendChild(iconDiv);
  inner.appendChild(amountEl);
  card.appendChild(inner);

  // Button lives outside the card, below it
  wrapper.appendChild(card);
  wrapper.appendChild(priceBtn);

  return wrapper;
}

function renderPageShopProducts(page: HTMLElement): void {
  updateShopHeaderBalances(page);
  const iapSnapshot = iapService.snapshot();
  // Mirror the old modal renderer: while a native store operation is in flight,
  // keep polling so purchase buttons re-enable once it clears (the idle/init
  // refresh loop stops at 'ready', so it can't do this on its own).
  if (iapSnapshot.nativeOperationInProgress) scheduleShopNativeOperationRefresh(page);
  const shopProducts = buildShopCatalog().products.filter((p) => p.group !== 'failOffer');
  const storeById = new Map(
    iapSnapshot.products
      .filter((p) => p.storeProduct !== null)
      .map((p) => [p.productId, p.storeProduct!]),
  );

  const entitlementsEl = page.querySelector<HTMLElement>('#shop-page-entitlements');
  if (entitlementsEl !== null) {
    const entitlements = shopProducts.filter((p) => p.group === 'entitlements');
    entitlementsEl.replaceChildren();
    for (const product of entitlements) {
      entitlementsEl.appendChild(
        renderFeaturedCard(product, storeById.get(product.productId) ?? null, iapSnapshot),
      );
    }
  }

  const hintsGrid = page.querySelector<HTMLElement>('#shop-hints-grid');
  if (hintsGrid !== null) {
    const hints = shopProducts.filter((p) => p.group === 'hints');
    hintsGrid.replaceChildren();
    hints.forEach((product, i) => {
      hintsGrid.appendChild(renderGridCard(product, storeById.get(product.productId) ?? null, iapSnapshot, i, 'hint-price-btn'));
    });
  }

  const coinsGrid = page.querySelector<HTMLElement>('#shop-coins-grid');
  if (coinsGrid !== null) {
    const coins = shopProducts.filter((p) => p.group === 'coins');
    coinsGrid.replaceChildren();
    coins.forEach((product, i) => {
      coinsGrid.appendChild(renderGridCard(product, storeById.get(product.productId) ?? null, iapSnapshot, i, 'coin-price-btn'));
    });
  }
}

function schedulePageShopProductsRefresh(page: HTMLElement): void {
  const iapState = iapService.snapshot().state;
  if (iapState !== 'idle' && iapState !== 'initializing') return;
  window.setTimeout(() => {
    if (!page.isConnected) return;
    if (!page.classList.contains('home-page-overlay--open')) return;
    renderCurrentShopPurchaseControls();
    schedulePageShopProductsRefresh(page);
  }, IAP_CONTROL_REFRESH_MS);
}

function renderSettingsPageBody(): string {
  return `
    <div class="settings-page-card">
      ${renderSettingsRows()}
    </div>
  `;
}

function renderSettingsRows(): string {
  return `
    <div class="settings-rows">
      <div class="modal-row settings-row">
        <div class="settings-row-left">
          <img class="settings-row-icon" src="/ui/settings/settings_icon_music.png" alt="" aria-hidden="true">
          <span class="settings-row-label">Music</span>
        </div>
        <label class="toggle-switch settings-toggle">
          <input type="checkbox" id="toggle-music" ${gameState.settings.musicOn ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="modal-row settings-row">
        <div class="settings-row-left">
          <img class="settings-row-icon" src="/ui/settings/settings_icon_sound.png" alt="" aria-hidden="true">
          <span class="settings-row-label">Sound Effects</span>
        </div>
        <label class="toggle-switch settings-toggle">
          <input type="checkbox" id="toggle-sfx" ${gameState.settings.soundEffectsOn ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="modal-row settings-row">
        <div class="settings-row-left">
          <img class="settings-row-icon" src="/ui/settings/settings_icon_vibration.png" alt="" aria-hidden="true">
          <span class="settings-row-label">Haptics</span>
        </div>
        <label class="toggle-switch settings-toggle">
          <input type="checkbox" id="toggle-haptics" ${gameState.settings.hapticsOn ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="settings-legal-footer" aria-label="Privacy, legal, and support links">
        <button id="privacy-choices-btn" class="settings-footer-link settings-footer-action" type="button" aria-label="Privacy choices, opens consent options">Privacy choices</button>
        <div class="settings-legal-links">
          <button id="privacy-policy-link-btn" class="settings-footer-link" type="button" aria-label="Privacy Policy, opens in browser">Privacy</button>
          <span class="settings-footer-separator" aria-hidden="true">•</span>
          <button id="terms-link-btn" class="settings-footer-link" type="button" aria-label="Terms of Service, opens in browser">Terms</button>
          <span class="settings-footer-separator" aria-hidden="true">•</span>
          <button id="support-link-btn" class="settings-footer-link" type="button" aria-label="Support, opens in browser">Support</button>
        </div>
      </div>
    </div>
  `;
}

function wireSettingsPageListeners(page: HTMLElement): void {
  page.querySelector('#privacy-policy-link-btn')?.addEventListener('click', () => {
    playUITap();
    openLegalLink('privacyPolicyUrl');
  });

  page.querySelector('#terms-link-btn')?.addEventListener('click', () => {
    playUITap();
    openLegalLink('termsUrl');
  });

  page.querySelector('#support-link-btn')?.addEventListener('click', () => {
    playUITap();
    openLegalLink('supportUrl');
  });

  const privacyChoicesButton = page.querySelector<HTMLButtonElement>('#privacy-choices-btn');
  privacyChoicesButton?.addEventListener('click', () => {
    if (privacyChoicesButton.disabled) return;
    playUITap();
    privacyChoicesButton.disabled = true;
    privacyChoicesButton.textContent = 'Opening…';
    void privacyConsentService.showPrivacyOptions()
      .then((result) => {
        if (!result.shown && privacyChoicesButton.isConnected) {
          showToast('Privacy choices are unavailable on this build.');
        }
      })
      .finally(() => {
        if (!privacyChoicesButton.isConnected) return;
        privacyChoicesButton.disabled = false;
        privacyChoicesButton.textContent = 'Privacy choices';
      });
  });

  page.querySelector('#toggle-music')?.addEventListener('change', (event) => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    const musicOn = event.currentTarget.checked;
    gameState.settings.musicOn = musicOn;
    gameState.settings.soundOn = gameState.settings.musicOn && gameState.settings.soundEffectsOn;
    gameState.save();
    setMusicEnabled(musicOn);
    syncAmbientMusicPreference();
    void analytics.settingsChanged({ setting_name: 'musicOn', new_value: String(musicOn) });
  });

  page.querySelector('#toggle-sfx')?.addEventListener('change', (event) => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    const soundEffectsOn = event.currentTarget.checked;
    gameState.settings.soundEffectsOn = soundEffectsOn;
    gameState.settings.soundOn = gameState.settings.musicOn && gameState.settings.soundEffectsOn;
    gameState.save();
    setSoundEffectsEnabled(soundEffectsOn);
    void analytics.settingsChanged({ setting_name: 'soundEffectsOn', new_value: String(soundEffectsOn) });
  });

  page.querySelector('#toggle-haptics')?.addEventListener('change', (event) => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    const hapticsOn = event.currentTarget.checked;
    gameState.settings.hapticsOn = hapticsOn;
    gameState.save();
    void analytics.settingsChanged({ setting_name: 'hapticsOn', new_value: String(hapticsOn) });
  });
}

function configureRestorePurchasesControl(modal: HTMLElement): void {
  const controls = shopRestoreControls(modal);
  if (restoreUiState !== 'pending' && restoreUiState !== 'restored') {
    restoreUiState = nextRestoreUiStateFromIap();
  }
  renderRestoreControl(controls, restoreUiState);
  controls.button.addEventListener('click', () => {
    void restorePurchasesFromShop();
  });
  scheduleRestoreControlRefresh(modal);
}

function shopRestoreControls(modal: HTMLElement): { button: HTMLButtonElement; status: HTMLElement } {
  const button = modal.querySelector<HTMLButtonElement>('#shop-restore-btn');
  const status = modal.querySelector<HTMLElement>('#shop-restore-status');
  if (button === null || status === null) {
    throw new Error('shop restore controls are missing from the shop modal');
  }
  return { button, status };
}

function restoreUiStateForIapSnapshot(iapSnapshot: IapSnapshot): RestoreUiState {
  if (activeRestorePromise !== null) return 'pending';
  if (restoreUiState === 'restored' || restoreUiState === 'empty' || restoreUiState === 'failed') return restoreUiState;
  if (iapSnapshot.nativeOperationInProgress) return 'busy';
  if (iapSnapshot.state === 'ready') return 'idle';
  if (iapSnapshot.state === 'idle' || iapSnapshot.state === 'initializing') return 'initializing';
  return 'unavailable';
}

function applyCompletedRestoreResultIfAvailable(): RestoreUiState | null {
  const completedRestore = iapService.consumeCompletedRestoreResult();
  if (completedRestore === null) return null;
  awaitingLateRestoreResult = false;
  restoreUiState = applyRestoreResult(completedRestore);
  renderCurrentRestoreControl();
  renderCurrentShopPurchaseControls();
  return restoreUiState;
}

function nextRestoreUiStateFromIap(): RestoreUiState {
  const completedRestoreState = applyCompletedRestoreResultIfAvailable();
  if (completedRestoreState !== null) return completedRestoreState;
  return restoreUiStateForIapSnapshot(iapService.snapshot());
}

function scheduleLateRestoreResultPoll(): void {
  if (lateRestorePollScheduled) return;
  lateRestorePollScheduled = true;
  window.setTimeout(() => {
    lateRestorePollScheduled = false;
    const completedRestoreState = applyCompletedRestoreResultIfAvailable();
    if (completedRestoreState !== null) return;

    const snapshot = iapService.snapshot();
    if (awaitingLateRestoreResult && snapshot.restoreInProgress) {
      scheduleLateRestoreResultPoll();
      return;
    }

    awaitingLateRestoreResult = false;
    restoreUiState = restoreUiStateForIapSnapshot(snapshot);
    renderCurrentRestoreControl();
    renderCurrentShopPurchaseControls();
  }, IAP_CONTROL_REFRESH_MS);
}

function restoreStatusText(state: RestoreUiState): string {
  if (state === 'idle') return 'Restore No Ads purchases on this device.';
  if (state === 'initializing') return 'Store is still loading.';
  if (state === 'busy') return 'Store operation in progress.';
  if (state === 'pending') return 'Checking your purchases…';
  if (state === 'restored') return '✓ No Ads restored.';
  if (state === 'empty') return 'No restorable No Ads purchase found.';
  if (state === 'failed') return 'Restore failed. Try again later.';
  return 'Store unavailable on this build.';
}

function renderRestoreControl(controls: { button: HTMLButtonElement; status: HTMLElement }, state: RestoreUiState): void {
  const nativeOperationInProgress = iapService.snapshot().nativeOperationInProgress;
  controls.status.textContent = restoreStatusText(state);
  controls.status.dataset.restoreState = state;
  controls.button.dataset.restoreState = state;
  controls.button.textContent = state === 'pending' ? 'Restoring…' : state === 'restored' ? 'Restored' : 'Restore';
  controls.button.disabled = nativeOperationInProgress
    || state === 'pending'
    || state === 'restored'
    || state === 'initializing'
    || state === 'busy'
    || state === 'unavailable';
}

function currentShopModal(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#home-page-overlay.home-page-shop') ?? null;
}

function renderCurrentRestoreControl(): void {
  const modal = currentShopModal();
  if (modal === null) return;
  renderRestoreControl(shopRestoreControls(modal), restoreUiState);
}

function refreshCurrentRestoreControl(): void {
  const modal = currentShopModal();
  if (modal === null) return;
  if (restoreUiState !== 'pending' && restoreUiState !== 'restored') {
    restoreUiState = nextRestoreUiStateFromIap();
  }
  renderRestoreControl(shopRestoreControls(modal), restoreUiState);
  scheduleRestoreControlRefresh(modal);
}

function scheduleRestoreControlRefresh(modal: HTMLElement): void {
  if (restoreUiState !== 'initializing' && restoreUiState !== 'busy') return;
  window.setTimeout(() => {
    if (!modal.isConnected) return;
    restoreUiState = nextRestoreUiStateFromIap();
    renderRestoreControl(shopRestoreControls(modal), restoreUiState);
    renderCurrentShopPurchaseControls();
    scheduleRestoreControlRefresh(modal);
  }, IAP_CONTROL_REFRESH_MS);
}

function restoreResultUiState(result: RestoreUiState): RestoreUiState {
  if ((result === 'busy' || result === 'failed' || result === 'unavailable') && iapService.snapshot().restoreInProgress) {
    awaitingLateRestoreResult = true;
    scheduleLateRestoreResultPoll();
    return 'busy';
  }
  return result;
}

async function restorePurchasesFromShop(): Promise<void> {
  if (activeRestorePromise !== null) {
    restoreUiState = 'pending';
    renderCurrentRestoreControl();
    renderCurrentShopPurchaseControls();
    return;
  }
  if (iapService.snapshot().nativeOperationInProgress) return;
  if (restoreUiState === 'pending' || restoreUiState === 'restored' || restoreUiState === 'initializing' || restoreUiState === 'busy' || restoreUiState === 'unavailable') return;

  playUITap();
  restoreUiState = 'pending';
  activeRestorePromise = applyRestoredPurchases();
  renderCurrentRestoreControl();
  renderCurrentShopPurchaseControls();
  try {
    restoreUiState = restoreResultUiState(await activeRestorePromise);
  } finally {
    activeRestorePromise = null;
    renderCurrentRestoreControl();
    renderCurrentShopPurchaseControls();
    const modal = currentShopModal();
    if (modal !== null) scheduleRestoreControlRefresh(modal);
  }
}

async function applyRestoredPurchases(): Promise<RestoreUiState> {
  return applyRestoreResult(await iapService.restore());
}

function applyRestoreResult(restore: IapRestoreResult): RestoreUiState {
  if (restore.status === 'unavailable') {
    return iapService.snapshot().nativeOperationInProgress ? 'busy' : 'unavailable';
  }
  if (restore.status !== 'restored') {
    return iapService.snapshot().nativeOperationInProgress ? 'busy' : 'failed';
  }

  const grant = restoreNonConsumableEntitlements(
    restore.ownedProductIds,
    buildFullShopCatalog().products,
    gameState,
  );

  if (!grant.noAds) return 'empty';

  updateHUD(lastKnownTotalDogs, lastKnownRestorationActive);
  showToast('No Ads restored');
  void adService.hideBanner();
  return 'restored';
}

function applyShopPurchaseButtonState(
  product: ShopCatalogProduct,
  action: HTMLButtonElement,
  iapState: IapServiceState,
  storeProduct: IapStoreProductSnapshot | null,
  fallbackPrice: string,
  purchaseInProgress: boolean,
  pendingPurchaseProductIds: readonly string[],
): void {
  const price = storeProduct?.priceString ?? fallbackPrice;
  const isPendingProduct = pendingPurchaseProductIds.includes(product.productId);
  const canPurchase = iapState === 'ready' && storeProduct !== null && !purchaseInProgress;
  action.disabled = !canPurchase;
  action.textContent = canPurchase ? price : isPendingProduct ? 'Purchasing…' : purchaseInProgress ? 'Please wait' : 'Unavailable';
  action.setAttribute('aria-label', `${product.title} ${price}. ${canPurchase ? 'Purchase' : 'Unavailable'}.`);
}

function currentStoreProductFor(product: ShopCatalogProduct): IapStoreProductSnapshot | null {
  return iapService.snapshot().products.find((candidate) => candidate.productId === product.productId)?.storeProduct ?? null;
}

function renderCurrentShopPurchaseControls(): void {
  const modal = currentShopModal();
  if (modal === null) return;

  updateShopHeaderBalances(modal);
  const iapSnapshot = iapService.snapshot();
  if (iapSnapshot.nativeOperationInProgress) scheduleShopNativeOperationRefresh(modal);
  const productsByCatalogId = new Map(
    buildShopCatalog().products
      .filter((product) => product.group !== 'failOffer')
      .map((product) => [product.id, product]),
  );

  // Old modal layout: product element carries data-catalog-id, button is a child
  for (const productEl of Array.from(modal.querySelectorAll<HTMLElement>('.shop-product[data-catalog-id]'))) {
    const product = productsByCatalogId.get(productEl.dataset.catalogId ?? '');
    const action = productEl.querySelector<HTMLButtonElement>('.shop-purchase-btn');
    if (product === undefined || action === null) continue;
    applyShopPurchaseButtonState(
      product, action, iapSnapshot.state, currentStoreProductFor(product),
      product.displayPrice, iapSnapshot.nativeOperationInProgress, iapSnapshot.pendingPurchaseProductIds,
    );
  }

  // New page layout: purchase button carries data-catalog-id directly
  for (const btn of Array.from(modal.querySelectorAll<HTMLButtonElement>('.shop-purchase-btn[data-catalog-id]'))) {
    const product = productsByCatalogId.get(btn.dataset.catalogId ?? '');
    if (product === undefined) continue;
    applyShopPurchaseButtonState(
      product, btn, iapSnapshot.state, currentStoreProductFor(product),
      product.displayPrice, iapSnapshot.nativeOperationInProgress, iapSnapshot.pendingPurchaseProductIds,
    );
  }
}

function scheduleShopNativeOperationRefresh(modal: HTMLElement): void {
  if (shopNativeOperationRefreshScheduledFor === modal) return;
  if (!iapService.snapshot().nativeOperationInProgress) return;
  shopNativeOperationRefreshScheduledFor = modal;
  window.setTimeout(() => {
    if (shopNativeOperationRefreshScheduledFor === modal) {
      shopNativeOperationRefreshScheduledFor = null;
    }
    const currentModal = modal.isConnected ? modal : currentShopModal();
    if (currentModal === null) return;
    renderCurrentShopPurchaseControls();
    renderCurrentRestoreControl();
    scheduleShopNativeOperationRefresh(currentModal);
  }, IAP_CONTROL_REFRESH_MS);
}

async function purchaseShopProduct(
  product: ShopCatalogProduct,
  action: HTMLButtonElement,
  price: string,
): Promise<void> {
  if (action.disabled) return;
  playUITap();
  action.disabled = true;
  action.textContent = 'Purchasing…';

  try {
    const purchasePromise = iapService.purchase(product.productId);
    renderCurrentShopPurchaseControls();
    refreshCurrentRestoreControl();
    const purchase = await purchasePromise;
    if (purchase.status !== 'purchased') {
      action.textContent = purchase.status === 'cancelled' ? 'Cancelled' : 'Unavailable';
      return;
    }

    const fulfillment = fulfillVerifiedPurchaseOnce(purchase, buildShopCatalog().products, gameState);
    // reportUnfulfilledPurchase fires a purchase:unfulfilled analytics event
    // for paid-but-not-delivered outcomes (so support/ops can see them) and
    // retries restore once for unverified purchases, re-verifying against the
    // FRESH customerInfo restore() returns (the original purchase.customerInfo
    // is the stale snapshot that failed verification). Returns the original
    // result, or a fulfilled result if the restore retry landed.
    const resolved = await reportUnfulfilledPurchase(
      fulfillment,
      analytics,
      makePurchaseRestoreRetry(purchase, {
        restore: () => iapService.restore(),
        products: () => buildShopCatalog().products,
        wallet: gameState,
      }),
    );
    if (resolved.status !== 'fulfilled') {
      action.textContent = resolved.status === 'duplicate' ? 'Already granted' : 'Not verified';
      return;
    }

    const grant = resolved.grant;
    if (grant === null) {
      action.textContent = 'Not verified';
      return;
    }

    if (grant.noAds) {
      void adService.hideBanner();
    }
    void analytics.purchaseFulfilled({
      product_id: fulfillment.productId,
      purchase_id: fulfillment.purchaseId,
      no_ads: grant.noAds,
      hints: grant.hints,
      coins: grant.coins,
      continue_level: grant.continueLevel,
    });
    updateHUD(lastKnownTotalDogs, lastKnownRestorationActive);
    updateShopHeaderBalances(currentShopModal() ?? document);
    action.textContent = shopPurchaseSuccessText(product);
  } finally {
    window.setTimeout(() => {
      renderCurrentShopPurchaseControls();
      refreshCurrentRestoreControl();
      if (!action.isConnected) return;
      const iapSnapshot = iapService.snapshot();
      applyShopPurchaseButtonState(
        product,
        action,
        iapSnapshot.state,
        currentStoreProductFor(product),
        price,
        iapSnapshot.nativeOperationInProgress,
        iapSnapshot.pendingPurchaseProductIds,
      );
    }, 1400);
  }
}

function shopPurchaseSuccessText(product: ShopCatalogProduct): string {
  if (product.kind === 'noAds') return 'No Ads active';
  if (product.kind === 'noAdsPremium') return 'No Ads + hints';
  if (product.kind === 'hintPack') return `+${product.hintAmount} hints`;
  if (product.kind === 'coinPack') return `+${product.coinAmount.toLocaleString('en-US')} coins`;
  return 'Granted';
}

function shopProductBadge(product: ShopCatalogProduct): string | null {
  if (product.kind === 'noAds') return 'One-time';
  if (product.kind === 'noAdsPremium') return 'Best Value';
  if (product.kind === 'hintPack' && product.hintAmount === 25) return 'Popular';
  if (product.kind === 'coinPack' && product.coinAmount === 10000) return 'Popular';
  if (product.kind === 'coinPack' && product.coinAmount >= 50000) return 'Best Value';
  if (product.kind === 'egoOffer') return 'Continue';
  return null;
}

function shopProductBenefit(product: ShopCatalogProduct): string {
  if (product.kind === 'noAds') return 'Remove ads from the game.';
  if (product.kind === 'noAdsPremium') return `No Ads plus ${product.hintAmount} hints.`;
  if (product.kind === 'hintPack') return `${product.hintAmount} hints for tough searches.`;
  if (product.kind === 'coinPack') return `${product.coinAmount.toLocaleString('en-US')} coins for continues and hints.`;
  return `${product.hintAmount} hints plus a level continue.`;
}

// --- Offline indicator + toast -------------------------------------

/** Duration a toast stays visible before fading out, in ms. */
const TOAST_DURATION_MS = 3000;
/** Fade-out transition duration (must match the CSS value). */
const TOAST_FADE_MS = 250;

/** Track + dismiss the currently-visible toast so stacked calls replace it. */
let activeToast: { el: HTMLElement; timers: ReturnType<typeof setTimeout>[] } | null = null;

/**
 * Show a small, time-boxed text toast in the HUD. Replaces any
 * currently-visible toast (no stacking). Uses vanilla DOM + CSS
 * transitions — kept minimal because the only two callers today are
 * the connectivity transitions.
 */
function showToast(message: string): void {
  const overlay = document.getElementById('hud-overlay');
  if (!overlay) return;

  // Dismiss any in-flight toast to avoid stacking.
  if (activeToast) {
    for (const t of activeToast.timers) clearTimeout(t);
    activeToast.el.remove();
    activeToast = null;
  }

  const el = document.createElement('div');
  el.className = 'hud-toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  overlay.appendChild(el);

  // Trigger the CSS enter transition on the next frame.
  requestAnimationFrame((): void => {
    el.classList.add('visible');
  });

  const fadeTimer = setTimeout((): void => {
    el.classList.remove('visible');
  }, TOAST_DURATION_MS);

  const removeTimer = setTimeout((): void => {
    el.remove();
    if (activeToast?.el === el) activeToast = null;
  }, TOAST_DURATION_MS + TOAST_FADE_MS);

  activeToast = { el, timers: [fadeTimer, removeTimer] };
}

/**
 * Wire online/offline listeners + sync the indicator icon with
 * navigator.onLine. Called once from initHUD.
 */
function initConnectivityIndicator(): void {
  const syncIcon = (): void => {
    const icon = document.getElementById('offline-indicator');
    icon?.classList.toggle('hidden', navigator.onLine);
  };
  syncIcon();

  window.addEventListener('online', (): void => {
    syncIcon();
    showToast('Back online');
  });
  window.addEventListener('offline', (): void => {
    syncIcon();
    showToast('Offline — playing cached levels');
  });
}
