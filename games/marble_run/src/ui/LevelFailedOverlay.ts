import { playLevelFail, playUITap } from '../audio/AudioManager';
import { scaffoldEvents } from '../core/ScaffoldEvents';
import { buildButtonElement, mountResultCard, type UiHandle } from '@fabrikav2/ui';
import { getModalRoot } from './modalRoot';
import { assetUrls } from '../../design/theme';

export interface FailContinueActionResult {
  resumed: boolean;
  message?: string;
}

export interface LevelFailedOverlayOptions {
  levelNumber: number;
  onRetry: () => void;
  onWatchAd: () => Promise<FailContinueActionResult>;
}

const OVERLAY_ID = 'level-failed-overlay';

/**
 * Kept as a no-op test-harness seam: the retired coin/IAP offer polling used a
 * pending-recovery timer, while the v1 Watch Ad path waits on the native result.
 */
export function setFailOverlayPendingRecoveryMsForTest(_ms: number | null): void {}

function buildFailIcon(): HTMLElement {
  const wrap = document.createElement('div');
  const img = document.createElement('img');
  img.src = assetUrls.iconFailed;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'contain';
  wrap.appendChild(img);
  return wrap;
}

export function showLevelFailedOverlay(levelId: string, options: LevelFailedOverlayOptions): void {
  const overlay = getModalRoot();
  if (!overlay || document.getElementById(OVERLAY_ID)) return;

  playLevelFail();
  scaffoldEvents.emit('level:fail', { levelId });

  const optionsContainer = document.createElement('div');
  optionsContainer.id = 'fail-options';
  optionsContainer.className = 'fail-options marble-fail-actions';
  const statusEl = document.createElement('p');
  statusEl.id = 'fail-continue-status';
  statusEl.className = 'fail-status';
  statusEl.setAttribute('aria-live', 'polite');

  let watchAdPending = false;
  const isOpen = (): boolean => handle?.el.isConnected ?? false;

  const retry = (): void => {
    if (watchAdPending) return;
    playUITap();
    handle.dismiss();
    options.onRetry();
  };

  const watchAd = buildButtonElement({
    label: 'WATCH AD',
    ariaLabel: 'Watch an ad to continue',
    dataAction: 'result-watch-ad',
    className: 'marble-result-action marble-fail-action marble-fail-watch-ad',
    spriteImage: assetUrls.buttonGreen,
    onClick: () => void runWatchAd(),
  });
  const retryButton = buildButtonElement({
    label: 'RETRY',
    ariaLabel: 'Retry level',
    dataAction: 'result-retry',
    className: 'marble-result-action marble-fail-action marble-fail-retry',
    spriteImage: assetUrls.buttonOrange,
    onClick: retry,
  });
  optionsContainer.append(watchAd, retryButton);

  async function runWatchAd(): Promise<void> {
    if (watchAdPending) return;
    playUITap();
    watchAdPending = true;
    watchAd.disabled = true;
    watchAd.dataset.disabled = 'true';
    watchAd.textContent = 'WATCHING...';

    const result = await options.onWatchAd();
    if (result.resumed || !isOpen()) return;

    watchAdPending = false;
    watchAd.disabled = false;
    watchAd.dataset.disabled = 'false';
    watchAd.textContent = 'WATCH AD';
    statusEl.textContent = result.message ?? 'Ad unavailable. Try again or retry the level.';
  }

  // Ribbon_Failed carries the styled FAILED word itself. Keep it as the only
  // title source, then add the level eyebrow separately to match the v1 card.
  const handle: UiHandle = mountResultCard({
    mountInto: overlay,
    id: OVERLAY_ID,
    variant: 'lose',
    title: '',
    eyebrow: `Level ${options.levelNumber}`,
    ribbonImage: assetUrls.ribbonFailed,
    cardImage: assetUrls.popup,
    art: buildFailIcon(),
    messages: ['No hearts left!', 'Watch an ad to continue.'],
    continueOffer: statusEl,
    actions: optionsContainer,
  });

  // ResultCard inserts actions into the card by default. v1 places the two
  // actions below it, so move the game-owned slot to the backdrop after mount.
  handle.el.appendChild(optionsContainer);
  window.setTimeout(() => retryButton.focus(), 0);
}
