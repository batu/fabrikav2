import { playLevelFail, playUITap } from '../audio/AudioManager';
import { scaffoldEvents } from '../core/ScaffoldEvents';
import type { FailContinueOfferSet, FailContinueOption, FailContinueOptionKind } from '../shop/FailContinueOffers';
import type { IapCatalogProductSnapshot } from '../shop/IapService';

export interface FailContinueActionResult {
  resumed: boolean;
  message?: string;
}

export interface FailContinueActionContext {
  shouldResume: () => boolean;
}

export interface LevelFailedOverlayOptions {
  getOffers: () => FailContinueOfferSet;
  getCoinBalance: () => number;
  getIapProducts: () => readonly IapCatalogProductSnapshot[];
  shouldRefreshOffers: () => boolean;
  onRetry: () => void;
  onCoinContinue: (option: FailContinueOption, context: FailContinueActionContext) => Promise<FailContinueActionResult>;
  onEgoOffer: (option: FailContinueOption, context: FailContinueActionContext) => Promise<FailContinueActionResult>;
}

type PendingKind = Exclude<FailContinueOptionKind, 'retry'> | null;

const OFFER_REFRESH_MS = 250;
const EGO_OFFER_PENDING_RECOVERY_MS = 15_000;
const FAIL_MASCOT_SRC = '/ui/level-complete/dog-detective-crying.png';
const COIN_ICON_SRC = '/ui/menu-icons/icon_coin.png';
const HINT_ICON_SRC = '/ui/menu-icons/icon_hint_magnifier.png';
const HEART_ICON_SRC = '/ui/menu-icons/icon_heart.png';

let pendingRecoveryMsForTest: number | null = null;

export function setFailOverlayPendingRecoveryMsForTest(ms: number | null): void {
  pendingRecoveryMsForTest = ms;
}

function egoOfferPendingRecoveryMs(): number {
  return pendingRecoveryMsForTest ?? EGO_OFFER_PENDING_RECOVERY_MS;
}

export function showLevelFailedOverlay(levelId: string, options: LevelFailedOverlayOptions): void {
  const overlay = document.getElementById('hud-overlay');
  if (!overlay) return;
  if (document.getElementById('level-failed-overlay')) return;

  playLevelFail();
  scaffoldEvents.emit('level:fail', { levelId });

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const el = document.createElement('div');
  el.id = 'level-failed-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'level-failed-title');
  el.tabIndex = -1;

  let pendingKind: PendingKind = null;
  let backgroundPendingKind: PendingKind = null;
  let backgroundPendingSuperseded = false;
  let statusMessage = '';
  let offerRefreshScheduled = false;
  let lastRenderSignature = '';

  const setPending = (kind: PendingKind): void => {
    pendingKind = kind;
    render();
  };

  const runAction = async (
    kind: Exclude<FailContinueOptionKind, 'retry'>,
    option: FailContinueOption,
    action: (candidate: FailContinueOption, context: FailContinueActionContext) => Promise<FailContinueActionResult>,
  ): Promise<void> => {
    if (pendingKind !== null || backgroundPendingKind === kind || option.status !== 'available') return;
    playUITap();
    setPending(kind);

    const recoveryTimer = kind === 'egoOffer'
      ? window.setTimeout(() => {
        if (!el.isConnected || pendingKind !== kind) return;
        backgroundPendingKind = kind;
        backgroundPendingSuperseded = false;
        statusMessage = 'Purchase is still processing. You can retry or choose another option; rewards apply if it finishes.';
        setPending(null);
      }, egoOfferPendingRecoveryMs())
      : null;

    const result = await action(option, {
      shouldResume: () => el.isConnected && (
        pendingKind === kind || (backgroundPendingKind === kind && !backgroundPendingSuperseded)
      ),
    });

    if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
    if (backgroundPendingKind === kind) {
      backgroundPendingKind = null;
      backgroundPendingSuperseded = false;
    } else if (backgroundPendingKind !== null && result.resumed) {
      backgroundPendingSuperseded = true;
    }
    if (result.resumed || !el.isConnected) return;
    statusMessage = result.message ?? 'Try another option.';
    if (pendingKind === kind) pendingKind = null;
    render();
    scheduleOfferRefresh();
  };

  const retry = (): void => {
    if (pendingKind !== null) return;
    playUITap();
    if (backgroundPendingKind !== null) backgroundPendingSuperseded = true;
    closeOverlay();
    options.onRetry();
  };

  const render = (): void => {
    const offers = options.getOffers().options;
    const coinBalance = options.getCoinBalance();
    const iapProducts = options.getIapProducts();
    lastRenderSignature = renderSignature(offers, coinBalance, iapProducts, pendingKind, backgroundPendingKind, statusMessage);
    el.innerHTML = `
      <div class="fail-rescue-balance" aria-label="Coin balance">
        <img src="${COIN_ICON_SRC}" alt="" aria-hidden="true">
        <span>${coinBalance.toLocaleString('en-US')}</span>
      </div>
      <section class="fail-card fail-rescue-card" aria-describedby="fail-continue-status">
        <h2 id="level-failed-title" class="level-failed-title-art"><img src="/ui/level-complete/out-of-lives-title.png" alt="Out of Lives"></h2>
        <div class="fail-rescue-art" aria-hidden="true">
          <span class="fail-rescue-halo"></span>
          <img class="fail-rescue-mascot" src="${FAIL_MASCOT_SRC}" alt="">
        </div>
        <div id="fail-options" class="fail-options fail-rescue-options"></div>
        <p id="fail-continue-status" class="fail-status" aria-live="polite">${escapeHtml(statusMessage)}</p>
      </section>
    `;

    const container = el.querySelector<HTMLDivElement>('#fail-options');
    if (!container) return;

    const primaryRow = document.createElement('div');
    primaryRow.className = 'fail-primary-actions';
    const coinOffer = offers.find((offer) => offer.kind === 'coinContinue');
    const retryOffer = offers.find((offer) => offer.kind === 'retry');

    if (coinOffer !== undefined) {
      const button = buttonForOffer(coinOffer, iapProducts, pendingKind, backgroundPendingKind);
      button.addEventListener('click', () => void runAction('coinContinue', coinOffer, options.onCoinContinue));
      primaryRow.appendChild(button);
    }
    if (retryOffer !== undefined) {
      const button = buttonForOffer(retryOffer, iapProducts, pendingKind, backgroundPendingKind);
      button.addEventListener('click', retry);
      primaryRow.appendChild(button);
    }
    container.appendChild(primaryRow);

    for (const offer of offers.filter((candidate) => candidate.kind === 'egoOffer')) {
      const button = buttonForOffer(offer, iapProducts, pendingKind, backgroundPendingKind);
      button.addEventListener('click', () => void runAction('egoOffer', offer, options.onEgoOffer));
      container.appendChild(button);
    }
    focusPreferredAction();
  };

  const focusableButtons = (): HTMLButtonElement[] => Array.from(el.querySelectorAll<HTMLButtonElement>('button'));

  const focusPreferredAction = (): void => {
    const buttons = focusableButtons();
    const preferred = buttons.find((button) => !button.disabled && button.dataset.kind === 'retry')
      ?? buttons.find((button) => !button.disabled)
      ?? buttons[0];
    window.setTimeout(() => {
      if (!el.isConnected) return;
      (preferred ?? el).focus();
    }, 0);
  };

  const restoreFocus = (): void => {
    if (previousFocus?.isConnected) previousFocus.focus();
  };

  const closeOverlay = (): void => {
    el.remove();
    restoreFocus();
  };

  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const buttons = focusableButtons().filter((button) => !button.disabled);
    if (buttons.length === 0) {
      event.preventDefault();
      el.focus();
      return;
    }
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  render();
  scheduleOfferRefresh();
  overlay.appendChild(el);
  focusPreferredAction();

  function scheduleOfferRefresh(): void {
    if (offerRefreshScheduled) return;
    if (pendingKind === null && !options.shouldRefreshOffers()) return;
    offerRefreshScheduled = true;
    window.setTimeout(() => {
      offerRefreshScheduled = false;
      if (!el.isConnected) return;
      if (pendingKind === null) {
        const offers = options.getOffers().options;
        const coinBalance = options.getCoinBalance();
        const iapProducts = options.getIapProducts();
        const nextSignature = renderSignature(offers, coinBalance, iapProducts, pendingKind, backgroundPendingKind, statusMessage);
        if (nextSignature !== lastRenderSignature) render();
      }
      scheduleOfferRefresh();
    }, OFFER_REFRESH_MS);
  }
}

function renderSignature(
  offers: readonly FailContinueOption[],
  coinBalance: number,
  iapProducts: readonly IapCatalogProductSnapshot[],
  pendingKind: PendingKind,
  backgroundPendingKind: PendingKind,
  statusMessage: string,
): string {
  return JSON.stringify({
    coinBalance,
    pendingKind,
    backgroundPendingKind,
    statusMessage,
    offers: offers.map((offer) => ({
      kind: offer.kind,
      status: offer.status,
      coinPrice: offer.coinPrice,
      productId: offer.productId,
      hintAmount: offer.hintAmount,
      coinAmount: offer.coinAmount,
    })),
    iapProducts: iapProducts.map((product) => ({
      productId: product.productId,
      displayPrice: product.displayPrice,
      storePrice: product.storeProduct?.priceString ?? null,
    })),
  });
}

function buttonForOffer(
  offer: FailContinueOption,
  iapProducts: readonly IapCatalogProductSnapshot[],
  pendingKind: PendingKind,
  backgroundPendingKind: PendingKind,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  const stateText = stateForOffer(offer, iapProducts, pendingKind, backgroundPendingKind);
  button.className = [
    'fail-option',
    `fail-option-${offer.kind}`,
    hierarchyClassForOffer(offer.kind),
    statusClassForOffer(offer, pendingKind, backgroundPendingKind),
    stateText === '' ? 'has-no-state' : 'has-state',
  ].join(' ');
  button.dataset.kind = offer.kind;
  button.id = idForOffer(offer.kind);
  button.disabled = pendingKind !== null || backgroundPendingKind === offer.kind || offer.status !== 'available';

  const icon = document.createElement('span');
  icon.className = 'fail-option-icon';
  const iconSrc = iconSrcForOffer(offer.kind);
  if (iconSrc !== null) {
    const image = document.createElement('img');
    image.src = iconSrc;
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    icon.appendChild(image);
  } else {
    icon.textContent = '😢';
    icon.setAttribute('aria-hidden', 'true');
  }

  const copy = document.createElement('span');
  copy.className = 'fail-option-copy';

  const title = document.createElement('span');
  title.className = 'fail-option-title';
  title.textContent = titleForOffer(offer, pendingKind, backgroundPendingKind);

  const meta = document.createElement('span');
  meta.className = 'fail-option-meta';
  meta.textContent = metaForOffer(offer);

  const state = document.createElement('span');
  state.className = 'fail-option-state';
  state.textContent = stateText;

  copy.append(title, meta);
  button.append(icon, copy, state);
  button.setAttribute('aria-label', ariaLabelForOffer(offer, title.textContent, meta.textContent, state.textContent));
  return button;
}

function idForOffer(kind: FailContinueOptionKind): string {
  if (kind === 'coinContinue') return 'coin-continue-btn';
  if (kind === 'egoOffer') return 'ego-offer-btn';
  return 'retry-btn';
}

function titleForOffer(offer: FailContinueOption, pendingKind: PendingKind, backgroundPendingKind: PendingKind): string {
  if (pendingKind === offer.kind) {
    if (offer.kind === 'egoOffer') return 'Purchasing...';
    if (offer.kind === 'coinContinue') return 'Continuing...';
  }
  if (backgroundPendingKind === offer.kind && offer.kind === 'egoOffer') return 'Purchase processing';
  if (offer.kind === 'coinContinue') return 'Continue';
  if (offer.kind === 'egoOffer') return 'Continue';
  return 'Retry';
}

function metaForOffer(offer: FailContinueOption): string {
  if (offer.kind === 'coinContinue') return `${offer.coinPrice.toLocaleString('en-US')} coins`;
  if (offer.kind === 'egoOffer') return `${offer.hintAmount}+ Hints + ${offer.coinAmount.toLocaleString('en-US')} Coins`;
  return '';
}

function priceForOffer(
  offer: FailContinueOption,
  iapProducts: readonly IapCatalogProductSnapshot[],
): string {
  const product = iapProducts.find((candidate) => candidate.productId === offer.productId);
  return product?.storeProduct?.priceString ?? product?.displayPrice ?? '$4.99';
}

function stateForOffer(
  offer: FailContinueOption,
  iapProducts: readonly IapCatalogProductSnapshot[],
  pendingKind: PendingKind,
  backgroundPendingKind: PendingKind,
): string {
  if (pendingKind === offer.kind) return 'Pending';
  if (backgroundPendingKind === offer.kind) return 'Processing';
  if (offer.status === 'disabled') return 'Unavailable';
  if (offer.kind === 'egoOffer') return priceForOffer(offer, iapProducts);
  return '';
}

function hierarchyClassForOffer(kind: FailContinueOptionKind): string {
  if (kind === 'coinContinue') return 'fail-option-coin-continue';
  if (kind === 'retry') return 'fail-option-retry-primary';
  return 'fail-option-bundle';
}

function statusClassForOffer(
  offer: FailContinueOption,
  pendingKind: PendingKind,
  backgroundPendingKind: PendingKind,
): string {
  if (pendingKind === offer.kind) return 'is-pending';
  if (backgroundPendingKind === offer.kind) return 'is-processing';
  if (offer.status === 'insufficientCoins') return 'is-insufficient';
  if (offer.status === 'disabled') return 'is-unavailable';
  return 'is-available';
}

function iconSrcForOffer(kind: FailContinueOptionKind): string | null {
  if (kind === 'coinContinue') return COIN_ICON_SRC;
  if (kind === 'egoOffer') return HINT_ICON_SRC;
  if (kind === 'retry') return HEART_ICON_SRC;
  return null;
}

function ariaLabelForOffer(
  offer: FailContinueOption,
  title: string,
  meta: string,
  state: string,
): string {
  if (offer.kind === 'retry') return 'Retry.';
  const stateSuffix = state.length > 0 ? ` ${state}.` : '';
  const coinStatusSuffix = offer.kind === 'coinContinue' && offer.status === 'insufficientCoins'
    ? ' Not enough coins.'
    : stateSuffix;
  if (meta.length === 0) return `${title}.${coinStatusSuffix}`;
  if (offer.kind === 'coinContinue') return `${title} for ${meta}.${coinStatusSuffix}`;
  return `${title}. ${meta}.${stateSuffix}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
