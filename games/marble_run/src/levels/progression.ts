import { LEVELS } from './levels.generated';

/**
 * Endless progression over the generated marble set.
 *
 * First pass plays levels 1…110 in order. After 110 the sequence loops back to
 * level 20 and runs 20…110 again, forever (product call, 2026-07-27: the first
 * 19 levels are the tutorial ramp and should not repeat).
 *
 * This is the single mapping from "how far the player has progressed" to "which
 * level content to load". Progress (`gameState.currentLevelIndex`) grows without
 * bound; content must not. Before this existed, level 111 indexed `LEVELS[110]`
 * — undefined — and the board engine would have been constructed with it.
 */

/** Where the sequence resumes after the final level. */
export const REPLAY_START_LEVEL = 20;

/** Number of levels in the repeating tail (20…110 inclusive). */
export const REPLAY_CYCLE_LENGTH = LEVELS.length - REPLAY_START_LEVEL + 1;

/**
 * Map a zero-based progress index to a 1-based playable level number.
 *
 * @param progressIndex `gameState.currentLevelIndex`; unbounded and may exceed
 *   the level count once the player has finished the set.
 */
export function contentLevelNumber(progressIndex: number): number {
  const index = Number.isFinite(progressIndex) ? Math.max(0, Math.floor(progressIndex)) : 0;
  if (index < LEVELS.length) return index + 1;
  return REPLAY_START_LEVEL + ((index - LEVELS.length) % REPLAY_CYCLE_LENGTH);
}
