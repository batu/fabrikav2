import type { InterstitialGateReason, LevelCompleteAction } from './AnalyticsService';

/**
 * Pure helpers for the between-level analytics (handoff 2026-09-14). They hold
 * no sink and emit nothing: GameScene and LevelCompleteOverlay call the
 * canonical AnalyticsService with what these return. Kept separate so the
 * cadence decision and the overlay action state machine are unit-testable
 * without Phaser or the DOM.
 */

export interface InterstitialGateInput {
  everyN: number;
  minLevelNumber: number;
  levelsCompletedSession: number;
  /** One-based number of the level about to start; GameScene evaluates
   *  `interstitialMinLevel` against it after the index has advanced. */
  nextLevelNumber: number;
  adsEnabled: boolean;
  hasNoAdsEntitlement: boolean;
  /** `areAutomaticAdsAllowed()`: false for a fresh install's first launch (PR #76). */
  automaticAdsAllowed: boolean;
}

export interface InterstitialGateDecision {
  eligible: boolean;
  reason: InterstitialGateReason;
}

/**
 * Mirrors GameScene's `shouldTry && settings.adsEnabled && areAutomaticAdsAllowed()`
 * decision and names the
 * first failing check. An eligible decision reports `cadence` (the rule that
 * let it through). The runtime decision itself stays in GameScene; this only
 * attributes it.
 */
export function resolveInterstitialGate(input: InterstitialGateInput): InterstitialGateDecision {
  const cadenceHit = input.everyN > 0 && input.levelsCompletedSession % input.everyN === 0;
  if (!cadenceHit) return { eligible: false, reason: 'cadence' };
  if (input.nextLevelNumber < input.minLevelNumber) return { eligible: false, reason: 'min_level' };
  if (input.hasNoAdsEntitlement) return { eligible: false, reason: 'no_ads_entitlement' };
  if (!input.adsEnabled) return { eligible: false, reason: 'ads_disabled' };
  if (!input.automaticAdsAllowed) return { eligible: false, reason: 'first_session' };
  return { eligible: true, reason: 'cadence' };
}

export interface LevelCompleteActionRecord {
  action: LevelCompleteAction;
  dwell_ms: number;
}

export interface LevelCompleteActionTracker {
  /** Records a background while the overlay is open. Once per overlay. */
  background(now?: number): LevelCompleteActionRecord | null;
  /** Records the action that leaves the overlay. Once per overlay; a later
   *  call (e.g. shutdown after Next) is ignored. */
  leave(action: Exclude<LevelCompleteAction, 'background'>, now?: number): LevelCompleteActionRecord | null;
  readonly left: boolean;
}

/** One overlay's action state: `background` may fire once and does not
 *  consume the terminal action; the terminal action fires at most once. */
export function createLevelCompleteActionTracker(mountedAt: number): LevelCompleteActionTracker {
  let backgrounded = false;
  let left = false;
  return {
    get left() {
      return left;
    },
    background(now = Date.now()) {
      if (backgrounded || left) return null;
      backgrounded = true;
      return { action: 'background', dwell_ms: Math.max(0, now - mountedAt) };
    },
    leave(action, now = Date.now()) {
      if (left) return null;
      left = true;
      return { action, dwell_ms: Math.max(0, now - mountedAt) };
    },
  };
}

/**
 * Carries the leave-overlay timestamp across the scene restart so the next
 * scene can report `next_level_ready.gap_ms`. Module state on purpose: the
 * scene instance that consumes it is not the one that produced it.
 */
interface PendingNextLevel {
  leftAt: number;
  afterInterstitial: boolean;
  completedLevelIndex?: number;
}

let pendingNextLevel: PendingNextLevel | null = null;

export function markLevelCompleteLeft(leftAt: number, completedLevelIndex?: number): void {
  pendingNextLevel = { leftAt, afterInterstitial: false, completedLevelIndex };
}

/** Presentation belongs to the completed level even after Next persists advancement.
 * The next scene consumes this context only after the interstitial has settled. */
export function pendingInterstitialLevelIndex(): number | undefined {
  return pendingNextLevel?.completedLevelIndex;
}

export function markInterstitialShownBeforeNextLevel(): void {
  if (pendingNextLevel !== null) pendingNextLevel.afterInterstitial = true;
}

/** Returns and clears the pending gap, or null when this level start did not
 *  follow a completion (fresh launch, level select, Home). */
export function consumeNextLevelReady(now: number): { gap_ms: number; after_interstitial: boolean } | null {
  if (pendingNextLevel === null) return null;
  const pending = pendingNextLevel;
  pendingNextLevel = null;
  return { gap_ms: Math.max(0, now - pending.leftAt), after_interstitial: pending.afterInterstitial };
}

export function resetBetweenLevelFlowForTest(): void {
  pendingNextLevel = null;
}
