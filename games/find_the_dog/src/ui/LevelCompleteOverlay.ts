import { gameState } from '../core/GameState';
import type { LevelData } from '../data/levels';
import { playLevelComplete, playUITap } from '../audio/AudioManager';
import { scaffoldEvents } from '../core/ScaffoldEvents';
import { showRatePromptWithHandle, type RatePromptHandle } from './RatePrompt';
import { animateCoinsToBalance } from './EconomyTransfer';
import { showSceneTransitionCover } from './SceneTransitionCover';
import { mountLevelComplete, type CoinTransfer, type ThemeTokens, type UiHandle } from '../v1core/ui';
import { FTD_UI_THEME } from './ftdTheme';

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

const COMPLETION_TITLE_SRC = '/ui/level-complete/level-complete-title.png';
const COMPLETION_MASCOT_SRC = '/ui/level-complete/dog-detective-complete.png';
const COMPLETION_COIN_ICON_SRC = '/ui/menu-icons/icon_coin.png';
// SVG mirror of the CSS-drawn rewardedAdIconMarkup badge (the 2x button's "AD +
// play" cue). Core renders the 2x icon as an <img> from --fab-complete-adicon-url,
// so the badge ships as an FTD asset rather than injected markup.
const COMPLETION_AD_BADGE_SRC = '/ui/level-complete/rewarded-ad-badge.svg';

// The fast-E2E gate stays in FTD; core never reads import.meta.env. The gate
// only chooses which timing-token VALUES we inject via the theme below.
const fastE2EUi = String(import.meta.env.VITE_FTD_FAST_E2E_UI) === 'true';

// Exported for parity with the pre-extraction surface (no current importers,
// but other modules historically referenced the entrance/reveal constants).
export const LEVEL_COMPLETE_ENTRANCE_MS = 620;
export const LEVEL_COMPLETE_REWARD_REVEAL_DELAY_MS = fastE2EUi ? 80 : 4200;
export const LEVEL_COMPLETE_REWARD_REVEAL_MS = fastE2EUi ? 40 : 860;

// The overlay root id. Kept as the pre-extraction id (rather than core's default
// 'fab-level-complete') so GameScene's shutdown teardown — which removes
// '#level-complete-overlay' and toggles '#hud-overlay.completion-mode' — stays
// unchanged, and so the '#hud-overlay.completion-mode > :not(#level-complete-
// overlay)' sibling-hide rule still matches.
const OVERLAY_ID = 'level-complete-overlay';

/**
 * FTD level-complete art + timing as ../v1core/ui --fab-complete-* tokens.
 * Art URLs mirror the pre-extraction asset constants; timings are computed from
 * the fast-E2E gate so the env stays in FTD. The 2x button's rewarded-ad badge
 * (previously the CSS-drawn rewardedAdIconMarkup) ships as an SVG asset injected
 * via --fab-complete-adicon-url, since core renders that icon as an <img>.
 */
const FTD_COMPLETE_THEME: ThemeTokens = {
  '--fab-complete-title-url': `url('${COMPLETION_TITLE_SRC}')`,
  '--fab-complete-mascot-url': `url('${COMPLETION_MASCOT_SRC}')`,
  '--fab-complete-coin-icon-url': `url('${COMPLETION_COIN_ICON_SRC}')`,
  '--fab-complete-adicon-url': `url('${COMPLETION_AD_BADGE_SRC}')`,
  '--fab-complete-entrance-ms': `${LEVEL_COMPLETE_ENTRANCE_MS}ms`,
  '--fab-complete-reward-reveal-delay-ms': `${fastE2EUi ? 80 : 4200}ms`,
  '--fab-complete-reward-reveal-ms': `${fastE2EUi ? 40 : 860}ms`,
  '--fab-complete-actions-delay-ms': `${fastE2EUi ? 0 : 260}ms`,
  '--fab-complete-coin-count-ms': `${fastE2EUi ? 0 : 760}ms`,
  '--fab-complete-message-interval-ms': '1600ms',
};

// Cache the warm-up promise per src (the decoded <img> itself is no longer
// retained — core builds its own <img> elements from the theme tokens; this
// only primes the browser's HTTP/image cache so those render instantly).
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

/**
 * Warm the HTTP cache for the celebration art before the overlay mounts. Stays
 * in FTD: core renders plain `<img>`/CSS-content images, so this preload makes
 * those resolve from cache for instant paint (the decode-clone micro-opt the
 * old single-file overlay used is dropped, per the extraction plan).
 */
export function preloadLevelCompleteAssets(): Promise<void> {
  completionAssetsReady ??= Promise.all([
    preloadCompletionImage(COMPLETION_TITLE_SRC),
    preloadCompletionImage(COMPLETION_MASCOT_SRC),
  ]).then(() => undefined);
  return completionAssetsReady;
}

/**
 * Show the Well Done overlay. Resolves when the player has dismissed it
 * (Next Level tapped, post-prompt flow resolved, currentLevelIndex
 * advanced). Caller restarts the scene after await.
 *
 * Thin wrapper over ../v1core/ui `mountLevelComplete`: FTD owns the side
 * effects (audio, scaffold event, asset preload), the re-entrancy guard, the
 * theme (art + timings), and the meaning injected via callbacks (coin-fly,
 * rate prompt, advance). Core owns the celebration presentation + sequencing.
 */
// The live overlay's core handle, so scene shutdown can dismiss it properly
// (abort the signal → run cleanups → clear timers → resolve dismissed), rather
// than only raw-removing the DOM node (which would defeat core's signal guards
// and leak its scheduled timers). Single overlay at a time, so one ref suffices.
let activeLevelCompleteHandle: UiHandle | null = null;

/**
 * Dismiss the live level-complete overlay, if any (idempotent). Call this from
 * scene shutdown INSTEAD of raw-removing #level-complete-overlay so core's
 * close() runs: aborts the AbortSignal its callbacks observe, clears its
 * scheduled timeouts + message interval, and resolves `dismissed`.
 */
export function dismissLevelCompleteOverlay(): void {
  activeLevelCompleteHandle?.dismiss();
}

export function showLevelCompleteOverlay(
  levelId: string,
  options: LevelCompleteOverlayOptions,
): Promise<LevelCompleteOverlayResult> {
  const overlay = document.getElementById('hud-overlay');
  if (!overlay) return Promise.resolve({ nextLevelData: null });
  // Re-entrancy: FTD semantics. If an overlay already exists, early-return a
  // resolved no-op (NOT core's live-handle re-entrancy — handing the caller an
  // in-flight overlay's handle would skew restart timing / drop the second
  // completion's data).
  if (document.getElementById(OVERLAY_ID)) {
    return Promise.resolve({ nextLevelData: null });
  }

  playLevelComplete();
  scaffoldEvents.emit('level:complete', { levelId });
  void preloadLevelCompleteAssets();

  // Balance pill starts at (balance − baseCoins) and counts up to the new
  // balance as coins fly in (mirrors the pre-extraction overlay).
  const balanceBefore = Math.max(0, options.coinBalance - options.baseCoins);

  overlay.classList.add('completion-mode');

  // The wrapper owns the public result Promise. It resolves ONLY on the Next
  // path (nextClicked) after core closes — bare external dismiss leaves it
  // pending forever, identical to the pre-extraction state machine (Fork 1).
  let nextClicked = false;
  let resolvePublic: (result: LevelCompleteOverlayResult) => void;
  const publicResult = new Promise<LevelCompleteOverlayResult>((resolve) => {
    resolvePublic = resolve;
  });

  const handle = mountLevelComplete({
    mountInto: overlay,
    id: OVERLAY_ID,
    theme: { ...FTD_UI_THEME, ...FTD_COMPLETE_THEME },
    content: {
      // Praise only: the overlay's art title already states LEVEL COMPLETE, so
      // a state-label subtitle ("Level Clear!") read as a duplicated/swapped
      // heading in review — every subtitle is now congratulatory copy.
      messages: ['Great Find!', 'Nice Work!'],
      rewardLabel: 'Coins earned',
      rewardAmount: options.baseCoins,
      balanceBefore,
      claimLabel: 'CLAIM',
      nextLabel: 'Next Level',
      nextLoadingLabel: 'Loading…',
      ...(options.claimX2Available
        ? {
            claimDouble: {
              label: 'CLAIM 2x',
              sublabel: 'Watch ad',
              loadingLabel: 'WAIT...',
              loadingSublabel: 'Loading ad',
              unavailableLabel: 'TRY LATER',
              unavailableSublabel: 'Ad unavailable',
              doubledRewardLabel: 'Doubled coins',
            },
          }
        : {}),
    },
    actions: {
      onClaim: async (transfer: CoinTransfer): Promise<void> => {
        await animateCoinsToBalance({
          amount: transfer.amount,
          source: transfer.source,
          owner: transfer.root,
          countElement: transfer.balanceCountEl,
          fromValue: balanceBefore,
          toValue: transfer.targetBalance,
          tokenMultiplier: transfer.tokenMultiplier,
          reducedMotion: transfer.reducedMotion,
        });
      },
      onClaimDouble: options.onClaimX2,
      onNext: async (signal: AbortSignal): Promise<void> => {
        nextClicked = true;

        // Advance + persist the level index IMMEDIATELY on Next-Level click.
        // Rationale: the click itself is the player's consent to advance. If
        // shutdown fires mid-rate-prompt-await below, the shutdown path
        // resolves the prompt Promise → this handler resumes → the
        // scene.restart guard skips — but ANY persistent mutation here has
        // already landed. Doing it upfront means the save reflects the
        // player's actual intent (they clicked) rather than being
        // conditional on the subsequent async path surviving shutdown.
        gameState.markActiveCompletionAdvanced(gameState.currentLevelIndex + 1);
        // Do not eager-load the next level here. On Android this can leave the
        // completion overlay stuck on "Loading..." when the WebView is busy
        // around ads/assets. Persist the advancement and let GameScene's normal
        // startup path load the selected wrapped content after restart.

        // Rate prompt: one-shot at the 5th total level-complete. The prompt
        // runs AFTER index persistence so shutdown-mid-prompt doesn't
        // corrupt state either way — the click-advance is already on disk.
        if (gameState.shouldShowRatePrompt()) {
          const promptHandle = showRatePromptWithHandle();
          options.onRatePromptHandle?.(promptHandle);
          try {
            await promptHandle.dismissed;
          } finally {
            options.onRatePromptHandle?.(null);
          }
        }

        // Short-circuit the transition-cover tail if the overlay was dismissed
        // mid-await (e.g. scene shutdown unblocked the rate prompt).
        if (!signal.aborted) showSceneTransitionCover();
      },
      onInteract: (): void => {
        playUITap();
      },
    },
  });
  activeLevelCompleteHandle = handle;

  // Public result resolves exactly once, on the Next path, after core closes
  // and resolves `dismissed`. Bare dismiss (no Next) → nextClicked false →
  // stays pending (parity with pre-extraction). Drop completion-mode here so a
  // bare dismiss (which never re-runs GameScene's teardown) doesn't leave the
  // hud-overlay stuck hiding its siblings.
  void handle.dismissed.then(() => {
    if (activeLevelCompleteHandle === handle) activeLevelCompleteHandle = null;
    overlay.classList.remove('completion-mode');
    if (nextClicked) resolvePublic({ nextLevelData: null });
  });

  return publicResult;
}
