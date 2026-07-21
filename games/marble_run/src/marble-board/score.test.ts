import { describe, expect, it } from 'vitest';
import { LEVELS } from './__fixtures__/sugar3d-levels';
import { scoreLevel } from './score';
import { solveLevel } from './solver';
import type { LevelDef } from './types';

/** Spearman rank correlation with average ranks for tied values. */
function spearman(a: readonly number[], b: readonly number[]): number {
  const rank = (xs: readonly number[]): number[] => {
    const idx = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    let start = 0;
    while (start < idx.length) {
      let end = start + 1;
      while (end < idx.length && idx[end]![0] === idx[start]![0]) end += 1;
      const averageRank = (start + 1 + end) / 2;
      for (let pos = start; pos < end; pos += 1) r[idx[pos]![1]] = averageRank;
      start = end;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const mean = (a.length + 1) / 2;
  const covariance = ra.reduce((sum, r, i) => sum + (r - mean) * (rb[i]! - mean), 0);
  const varianceA = ra.reduce((sum, r) => sum + (r - mean) ** 2, 0);
  const varianceB = rb.reduce((sum, r) => sum + (r - mean) ** 2, 0);
  const denominator = Math.sqrt(varianceA * varianceB);
  return denominator === 0 ? 0 : covariance / denominator;
}

describe('scoreLevel', () => {
  const scores = LEVELS.map((level) => scoreLevel(level));

  it('returns a finite score in [1, 20] for every committed level', () => {
    for (const s of scores) {
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(20);
    }
  });

  it('is deterministic', () => {
    for (const level of LEVELS) {
      expect(scoreLevel(level)).toBe(scoreLevel(level));
    }
  });

  it('does not mutate the level definition', () => {
    const level = structuredClone(LEVELS[0]!);
    const before = structuredClone(level);
    scoreLevel(level);
    expect(level).toEqual(before);
  });

  it('anchors the committed curve at both ends', () => {
    expect(scores[0]).toBeLessThanOrEqual(3);
    expect(scores[scores.length - 1]).toBeGreaterThanOrEqual(15);
  });

  it('rises with level id (rank correlation, tolerating local dips)', () => {
    // Levels 11, 16 and 19 are measurably easier than their neighbours, so
    // exact per-pair monotonicity would fail — the tolerance is load-bearing.
    const ids = LEVELS.map((l) => l.id);
    expect(spearman(ids, scores)).toBeGreaterThanOrEqual(0.9);
  });

  it('does not mistake tied scores for an ordered difficulty curve', () => {
    const ids = LEVELS.map((l) => l.id);
    const collapsed = [...Array<number>(scores.length - 1).fill(1), 20];
    expect(spearman(ids, collapsed)).toBeLessThan(0.9);
  });

  it('uses the range rather than clustering', () => {
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThanOrEqual(12);
  });

  it('returns the maximum for an unsolvable level', () => {
    // One red marble, only a blue gate: it can never exit.
    const unsolvable: LevelDef = {
      id: 999,
      cols: 2,
      rows: 2,
      cells: ['R.', '..'],
      gates: [{ side: 'top', index: 0, color: 'blue' }],
    };
    expect(solveLevel(unsolvable).solvable).toBe(false);
    expect(scoreLevel(unsolvable)).toBe(20);
  });

  it('returns the minimum for a solvable level with no marbles', () => {
    const empty: LevelDef = {
      id: 1000,
      cols: 1,
      rows: 1,
      cells: ['.'],
      gates: [],
    };
    expect(scoreLevel(empty)).toBe(1);
  });

  it('ignores cells outside the declared board dimensions', () => {
    const level = LEVELS[0]!;
    const padded: LevelDef = {
      ...level,
      cells: [...level.cells.map((row) => `${row}.`), '.'.repeat(level.cols + 1)],
    };
    expect(scoreLevel(padded)).toBe(scoreLevel(level));
  });
});
