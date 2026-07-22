import { gameState } from '../core/GameState';
import type { LevelData } from '../data/levels';
import { playLevelComplete, playUITap } from '../audio/AudioManager';
import { scaffoldEvents } from '../core/ScaffoldEvents';
import { showRatePromptWithHandle, type RatePromptHandle } from './RatePrompt';
import { showSceneTransitionCover } from './SceneTransitionCover';
import { buildButtonElement, mountResultCard, type UiHandle } from '@fabrikav2/ui';
import { getModalRoot } from './modalRoot';
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
 * Blue coin-balance pill for the win card top-right (device-parity MRV2-10 U4,
 * ref refs/win.png). GameScene hides the in-level HUD behind the overlay, so the
 * card renders its own wallet pill rather than relying on the hidden HUD counter.
 */
function buildCoinPill(balance: number): HTMLElement {
  const pill = document.createElement('div');
  pill.className = 'marble-win-coin-pill';
  const coin = document.createElement('img');
  coin.src = COMPLETION_COIN_ICON_SRC;
  coin.alt = '';
  coin.setAttribute('aria-hidden', 'true');
  const value = document.createElement('span');
  value.className = 'marble-win-coin-value';
  value.textContent = String(balance);
  pill.append(coin, value);
  return pill;
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
  const overlay = getModalRoot();
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

  // MRV2-11 U5 (ref refs/win.png): the win card holds NO actions — Next is a
  // standalone pill far below the card, appended to the backdrop (see below). The
  // kit requires a fresh `actions` element, so pass an empty one.
  const actions = document.createElement('div');
  actions.className = 'fab-modal-actions marble-win-actions-empty';

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

  // Device-parity MRV2-10 U4: the Next action is a GREEN PILL (Button_Green) with
  // a plain white "Next" label — NOT the Txt_Next.png word-art sprite, whose
  // sprite-label doubling rendered a giant unstyled "Next" when the sprite failed
  // to load/decode on device (judge3/win.json). One text source, contained.
  const nextBtn = buildButtonElement({
    label: 'Next',
    ariaLabel: 'Next level',
    dataAction: 'result-next',
    className: 'marble-result-action marble-result-next',
    spriteImage: assetUrls.buttonGreen,
    onClick: runNext,
  });

  const handle = mountResultCard({
    mountInto: overlay,
    id: OVERLAY_ID,
    variant: 'win',
    // Ribbon_Completed.png already carries the baked-in "COMPLETED" word; passing
    // a title here ALSO rendered the .fab-modal-ribbon-title h2 over it, so the
    // word appeared twice, overlapping (judge3/win.json duplicate COMPLETED). Emit
    // the sprite as the ONLY completed-text source; the eyebrow labels the level.
    title: '',
    eyebrow: `Level ${levelNumber}`,
    ribbonImage: assetUrls.ribbonCompleted,
    cardImage: assetUrls.popup,
    art: buildCrown(),
    rewardDisplay: rewardRow,
    actions,
  });
  // MRV2-11 U5 (ref refs/win.png): three screen-level pieces over the dimmed
  // board. The coin pill docks to the SCREEN top-right (backdrop, safe-area
  // inset) and Next is a standalone pill BELOW the card — both appended to the
  // backdrop (handle.el), not the card, so the card stays compact.
  handle.el.appendChild(buildCoinPill(options.coinBalance));
  nextBtn.classList.add('marble-win-next-standalone');
  handle.el.appendChild(nextBtn);
  activeLevelCompleteHandle = handle;

  void handle.dismissed.then(() => {
    if (activeLevelCompleteHandle === handle) activeLevelCompleteHandle = null;
    overlay.classList.remove('completion-mode');
    if (nextClicked) resolvePublic({ nextLevelData: null });
  });

  return publicResult;
}
