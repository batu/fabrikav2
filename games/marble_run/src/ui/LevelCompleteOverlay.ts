import { gameState } from '../core/GameState';
import type { LevelData } from '../data/levels';
import { playClaim, playLevelComplete, playUITap } from '../audio/AudioManager';
import { scaffoldEvents } from '../core/ScaffoldEvents';
import { showRatePromptWithHandle, type RatePromptHandle } from './RatePrompt';
import { showSceneTransitionCover } from './SceneTransitionCover';
import { buildButtonElement, mountResultCard, type UiHandle } from '@fabrikav2/ui';
import { assetUrls } from '../../design/theme';

export interface LevelCompleteOverlayOptions {
  /** Seconds this attempt took. Required — drives the ⏱ readout. */
  timeSeconds: number;
  /** True iff this run improved on the player's previous best for this level. */
  newBest: boolean;
  /** Previous best (before this run) in seconds. Undefined when this is the first-ever completion. */
  previousBest?: number;
  baseCoins: number;
  coinBalance: number;
  claimX2Available: boolean;
  onClaimX2?: () => Promise<{ granted: boolean; coinBalance: number }>;
  /**
   * Optional sink for the rate-prompt handle while it's on-screen, so the
   * scene can dismiss it on shutdown. Called with a handle when the prompt
   * opens and with `null` when it closes.
   */
  onRatePromptHandle?: (handle: RatePromptHandle | null) => void;
}

export interface LevelCompleteOverlayResult {
  nextLevelData: LevelData | null;
}

const COMPLETION_TITLE_SRC = assetUrls.ribbonCompleted;
const COMPLETION_COIN_ICON_SRC = assetUrls.coinIcon;

// Retained exports for callers that historically referenced the entrance/reveal
// constants. The sugar ResultCard does not run the old count-up sequence.
export const LEVEL_COMPLETE_ENTRANCE_MS = 620;
export const LEVEL_COMPLETE_REWARD_REVEAL_DELAY_MS = 4200;
export const LEVEL_COMPLETE_REWARD_REVEAL_MS = 860;

const OVERLAY_ID = 'level-complete-overlay';

const completionImageCache = new Map<string, Promise<void>>();

function preloadCompletionImage(src: string): Promise<void> {
  const cached = completionImageCache.get(src);
  if (cached) return cached;
  const image = new Image();
  image.loading = 'eager';
  image.decoding = 'async';
  (image as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'high';
  image.src = src;
  const ready = (image.decode?.() ?? Promise.resolve()).catch(() => undefined);
  completionImageCache.set(src, ready);
  return ready;
}

let completionAssetsReady: Promise<void> | null = null;

/** Warm the HTTP cache for the win-card art before the overlay mounts. */
export function preloadLevelCompleteAssets(): Promise<void> {
  completionAssetsReady ??= Promise.all([
    preloadCompletionImage(assetUrls.popup),
    preloadCompletionImage(assetUrls.ribbonCompleted),
    preloadCompletionImage(assetUrls.crown),
    preloadCompletionImage(assetUrls.nextText),
  ]).then(() => undefined);
  return completionAssetsReady;
}

let activeLevelCompleteHandle: UiHandle | null = null;

/** Dismiss the live level-complete overlay, if any (idempotent). */
export function dismissLevelCompleteOverlay(): void {
  activeLevelCompleteHandle?.dismiss();
}

function buildCrown(): HTMLElement {
  const wrap = document.createElement('div');
  const img = document.createElement('img');
  img.src = assetUrls.crown;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'contain';
  wrap.appendChild(img);
  return wrap;
}

function buildRewardRow(amount: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'marble-reward-row';
  const rewardText = document.createElement('img');
  rewardText.className = 'marble-reward-text';
  rewardText.src = assetUrls.rewardText;
  rewardText.alt = 'Reward';
  const coin = document.createElement('img');
  coin.src = COMPLETION_COIN_ICON_SRC;
  coin.alt = '';
  coin.setAttribute('aria-hidden', 'true');
  const value = document.createElement('span');
  value.className = 'marble-reward-value';
  value.textContent = `+${amount}`;
  row.append(rewardText, coin, value);
  return row;
}

/**
 * Show the level-complete card. Resolves when the player taps Next (advance +
 * persist already applied). Sugar-skinned kit ResultCard replaces the v1core
 * mountLevelComplete DOM; the claim-×2 rewarded-ad economy is preserved via a
 * green CLAIM 2x action, but the coin count-up / reward-reveal animation is
 * dropped (see docs/shell-parity-gaps.md).
 */
export function showLevelCompleteOverlay(
  levelId: string,
  options: LevelCompleteOverlayOptions,
): Promise<LevelCompleteOverlayResult> {
  const overlay = document.getElementById('hud-overlay');
  if (!overlay) return Promise.resolve({ nextLevelData: null });
  if (document.getElementById(OVERLAY_ID)) {
    return Promise.resolve({ nextLevelData: null });
  }

  playLevelComplete();
  scaffoldEvents.emit('level:complete', { levelId });
  void preloadLevelCompleteAssets();
  void COMPLETION_TITLE_SRC;

  overlay.classList.add('completion-mode');

  let nextClicked = false;
  let resolvePublic: (result: LevelCompleteOverlayResult) => void;
  const publicResult = new Promise<LevelCompleteOverlayResult>((resolve) => {
    resolvePublic = resolve;
  });

  const levelNumber = gameState.currentLevelIndex + 1;
  const rewardRow = buildRewardRow(options.baseCoins);
  const rewardValue = rewardRow.querySelector<HTMLElement>('.marble-reward-value');

  const actions = document.createElement('div');
  actions.className = 'fab-modal-actions';

  let claimBtn: HTMLButtonElement | null = null;
  if (options.claimX2Available && options.onClaimX2 !== undefined) {
    claimBtn = buildButtonElement({
      label: 'Claim 2x',
      dataAction: 'result-claim-x2',
      className: 'marble-result-action marble-claim-x2',
      spriteImage: assetUrls.buttonGreen,
      onClick: () => {
        if (!claimBtn) return;
        claimBtn.disabled = true;
        claimBtn.textContent = 'Loading…';
        playClaim();
        void options.onClaimX2!().then((result) => {
          if (result.granted && rewardValue) {
            rewardValue.textContent = `+${options.baseCoins * 2}`;
          }
          claimBtn?.remove();
          claimBtn = null;
        });
      },
    });
    actions.appendChild(claimBtn);
  }

  const runNext = (): void => {
    if (nextClicked) return;
    nextClicked = true;
    playUITap();
    // The click is the player's consent to advance — persist immediately.
    gameState.markActiveCompletionAdvanced(gameState.currentLevelIndex + 1);

    const finish = (): void => {
      showSceneTransitionCover();
      handle.dismiss();
    };

    if (gameState.shouldShowRatePrompt()) {
      const promptHandle = showRatePromptWithHandle();
      options.onRatePromptHandle?.(promptHandle);
      void promptHandle.dismissed.finally(() => {
        options.onRatePromptHandle?.(null);
        finish();
      });
      return;
    }
    finish();
  };

  const nextBtn = buildButtonElement({
    label: 'Next',
    ariaLabel: 'Next level',
    dataAction: 'result-next',
    className: 'marble-result-action marble-result-next',
    spriteImage: assetUrls.nextText,
    onClick: runNext,
  });
  actions.appendChild(nextBtn);

  const handle = mountResultCard({
    mountInto: overlay,
    id: OVERLAY_ID,
    variant: 'win',
    title: 'Completed',
    eyebrow: `Level ${levelNumber}`,
    ribbonImage: assetUrls.ribbonCompleted,
    cardImage: assetUrls.popup,
    art: buildCrown(),
    rewardDisplay: rewardRow,
    actions,
  });
  activeLevelCompleteHandle = handle;

  void handle.dismissed.then(() => {
    if (activeLevelCompleteHandle === handle) activeLevelCompleteHandle = null;
    overlay.classList.remove('completion-mode');
    if (nextClicked) resolvePublic({ nextLevelData: null });
  });

  return publicResult;
}
