/**
 * Interstitial cadence policy — a pure, deterministic decision extracted from
 * find_the_dog's inline `triggerLevelFinale` logic (GameScene.ts:1716-1721,
 * research 07 R28). The *level* cadence lives here as plain arithmetic; the
 * *time* cap (min interval between impressions) stays where it belongs, inside
 * each adapter's `maybeShowInterstitial` frequency gate. Keeping the two apart
 * makes the level decision testable without a clock and the time cap testable
 * with an injected `now`.
 */

export interface InterstitialCadencePolicy {
  /** Show at most once every N completed levels. `0` disables interstitials entirely. */
  everyNLevels: number;
  /** 1-based level floor: never show before the player reaches this level. */
  minLevel: number;
  /** Minimum seconds between impressions; passed as `minIntervalMs` to `maybeShowInterstitial`. */
  minIntervalS: number;
}

export interface InterstitialCadenceState {
  /** Levels the player has completed this session (drives the every-N counter). */
  levelsCompletedThisSession: number;
  /** The player's current level, 1-based (drives the floor). */
  currentLevel: number;
}

/**
 * Does the level counter alone permit an interstitial attempt? Pure: the same
 * inputs always produce the same result. The caller still passes the result
 * through `maybeShowInterstitial`, which applies the independent time cap.
 */
export function shouldShowInterstitial(
  policy: Pick<InterstitialCadencePolicy, 'everyNLevels' | 'minLevel'>,
  state: InterstitialCadenceState,
): boolean {
  const { everyNLevels, minLevel } = policy;
  if (everyNLevels <= 0) return false;
  if (state.levelsCompletedThisSession <= 0) return false;
  if (state.levelsCompletedThisSession % everyNLevels !== 0) return false;
  if (state.currentLevel < minLevel) return false;
  return true;
}
