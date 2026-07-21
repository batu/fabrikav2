/**
 * Measured difficulty score.
 *
 * The point of this module is to REPLACE prescribed difficulty (generator
 * knobs) with a measurement: run the exact greedy-peel solver, read the
 * signals it already produces, and fold them into a single 1-20 number.
 * A level generator can then propose levels and VERIFY their difficulty.
 */
import { solveLevel } from './solver';
import type { LevelDef } from './types';

/**
 * Weights and normalization anchors, calibrated against the 20 committed
 * sugar3d levels (vendored as `__fixtures__/sugar3d-levels.ts`) so they land
 * roughly monotonically 2 -> 18. See `score.test.ts` for the contract they
 * satisfy.
 */
const MARBLE_MIN = 6;
const MARBLE_MAX = 120;
const WAVE_MIN = 2;
const WAVE_MAX = 20;
const BLOCKED_MIN = 0.25;
const BLOCKED_MAX = 0.95;
const AREA_MIN = 9;
const AREA_MAX = 180;

const W_MARBLES = 0.34;
const W_WAVES = 0.28;
const W_BLOCKED = 0.24;
const W_AREA = 0.14;

const SCORE_MIN = 1;
const SCORE_MAX = 20;

/** Log-scaled 0..1 position of `value` between `min` and `max` (unclamped ends are clamped). */
function logNorm(value: number, min: number, max: number): number {
  const t = Math.log(Math.max(value, min) / min) / Math.log(max / min);
  return Math.min(1, Math.max(0, t));
}

function linNorm(value: number, min: number, max: number): number {
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Cells that are part of the playable tray (not void, not plug). */
function playableArea(level: LevelDef): number {
  let area = 0;
  for (let y = 0; y < level.rows; y += 1) {
    const row = level.cells[y]!;
    for (let x = 0; x < level.cols; x += 1) {
      const ch = row[x];
      if (ch !== '#' && ch !== 'X') area += 1;
    }
  }
  return area;
}

/**
 * Difficulty of `level` on a 1-20 scale (fractional). Pure and deterministic.
 *
 * Unsolvable levels have no meaningful difficulty; they return the maximum
 * (20) rather than throwing, so the function stays total. Callers verifying
 * generated levels should reject on `solveLevel().solvable` first.
 */
export function scoreLevel(level: LevelDef): number {
  const { solvable, waves, order } = solveLevel(level);
  if (!solvable) return SCORE_MAX;

  const marbles = order.length;
  if (marbles === 0) return SCORE_MIN;

  const openFrac = waves[0] / marbles;
  const blockedFrac = 1 - openFrac;

  const t =
    W_MARBLES * logNorm(marbles, MARBLE_MIN, MARBLE_MAX) +
    W_WAVES * logNorm(waves.length, WAVE_MIN, WAVE_MAX) +
    W_BLOCKED * linNorm(blockedFrac, BLOCKED_MIN, BLOCKED_MAX) +
    W_AREA * logNorm(playableArea(level), AREA_MIN, AREA_MAX);

  const score = SCORE_MIN + (SCORE_MAX - SCORE_MIN) * t;
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, score));
}
