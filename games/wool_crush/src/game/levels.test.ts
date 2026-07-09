import { describe, expect, it } from 'vitest';
import { canTapThread, tapThread, tick } from './engine.ts';
import { buildDragon, colorTotals, createLevelState, LEVELS } from './levels.ts';
import type { Color, GameState } from './types.ts';

/** Count dragon sections per color. */
function sectionTotals(state: GameState): Map<Color, number> {
  const totals = new Map<Color, number>();
  for (const sec of state.dragon.sections) totals.set(sec.color, (totals.get(sec.color) ?? 0) + 1);
  return totals;
}

describe('levels — shape', () => {
  it('ships exactly 3 levels with the intended color ramp (3 → 4 → 5)', () => {
    expect(LEVELS.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(colorTotals(LEVELS[0]!.threads).size).toBe(3);
    expect(colorTotals(LEVELS[1]!.threads).size).toBe(4);
    expect(colorTotals(LEVELS[2]!.threads).size).toBe(5);
  });
});

describe('conservation invariant (all levels)', () => {
  it.each(LEVELS.map((l) => [l.id, l] as const))(
    'level %i: dragon sections per color == total thread length per color',
    (_id, level) => {
      const state = createLevelState(level);
      const threadTotals = colorTotals(level.threads);
      const dragonTotals = sectionTotals(state);

      // Same colors, same per-color counts, same grand total.
      expect(new Set(dragonTotals.keys())).toEqual(new Set(threadTotals.keys()));
      for (const [color, count] of threadTotals) {
        expect(dragonTotals.get(color)).toBe(count);
      }
      const grand = [...threadTotals.values()].reduce((a, b) => a + b, 0);
      expect(state.dragon.sections).toHaveLength(grand);
    },
  );

  it('the deterministic shuffle permutes (does not lose or add) sections', () => {
    const specs = LEVELS[2]!.threads;
    const a = buildDragon(specs, 3).map((s) => s.color).sort();
    const b = buildDragon(specs, 3).map((s) => s.color).sort();
    const c = buildDragon(specs, 99).map((s) => s.color).sort();
    expect(a).toEqual(b); // same seed → same multiset (and order, below)
    expect(a).toEqual(c); // different seed → same multiset, different order
    expect(buildDragon(specs, 3)).toEqual(buildDragon(specs, 3));
    expect(buildDragon(specs, 3)).not.toEqual(buildDragon(specs, 99));
  });
});

/**
 * Greedy auto-player: keep every free slot fed with any currently-tappable
 * thread, then tick. Used to prove L1 is winnable end-to-end by a naive policy.
 */
function greedyPlay(level: Parameters<typeof createLevelState>[0], maxTicks: number): GameState {
  let s = createLevelState(level);
  for (let step = 0; step < maxTicks && s.status === 'playing'; step += 1) {
    // Fill free slots with tappable threads until none fit.
    for (;;) {
      if (!s.slots.some((slot) => slot === null)) break;
      const next = s.board.threads.find((t) => canTapThread(s, t.id));
      if (!next) break;
      s = tapThread(s, next.id);
    }
    s = tick(s, 1);
  }
  return s;
}

describe('L1 is winnable by a naive greedy policy', () => {
  it('reaches "won" with the board and slots empty and dragon consumed', () => {
    const end = greedyPlay(LEVELS[0]!, 200);
    expect(end.status).toBe('won');
    expect(end.board.threads).toHaveLength(0);
    expect(end.slots.every((x) => x === null)).toBe(true);
    expect(end.dragon.sections).toHaveLength(0);
  });
});

describe('determinism (level level)', () => {
  it('same taps + dt sequence on a fresh L3 → identical end state', () => {
    const run = (): GameState => {
      let s = createLevelState(LEVELS[2]!);
      const dts = [0.5, 1, 0.3, 2, 1, 0.7];
      for (let i = 0; i < s.board.threads.length + 6; i += 1) {
        const t = s.board.threads.find((th) => canTapThread(s, th.id));
        if (t) s = tapThread(s, t.id);
        s = tick(s, dts[i % dts.length]!);
      }
      return s;
    };
    expect(run()).toEqual(run());
  });
});
