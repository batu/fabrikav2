import { describe, expect, it } from 'vitest';
import {
  activeSlots,
  canTapThread,
  hasActivePull,
  tapLegality,
  tapThread,
  tick,
  visibleSections,
} from './engine.ts';
import type { Color, DragonSection, GameState, Spool, Thread } from './types.ts';

// ── Builders ────────────────────────────────────────────────────────

function sections(...colors: Color[]): DragonSection[] {
  return colors.map((color) => ({ color }));
}

function spool(color: Color, capacity: number, pulled = 0): Spool {
  return { color, capacity, pulled };
}

/** A minimal playing state; every field overridable for a scenario. */
function makeState(overrides: {
  threads?: Thread[];
  cols?: number;
  rows?: number;
  slots?: (Spool | null)[];
  sections?: DragonSection[];
  window?: number;
  trackLength?: number;
  headProgress?: number;
  speed?: number;
  pullRate?: number;
  pullAccumulator?: number;
}): GameState {
  return {
    status: 'playing',
    levelId: 0,
    board: { cols: overrides.cols ?? 6, rows: overrides.rows ?? 6, threads: overrides.threads ?? [] },
    slots: overrides.slots ?? [null, null, null, null],
    dragon: {
      sections: overrides.sections ?? [],
      headProgress: overrides.headProgress ?? 0,
      trackLength: overrides.trackLength ?? 100,
      window: overrides.window ?? 12,
      pullAccumulator: overrides.pullAccumulator ?? 0,
    },
    speed: overrides.speed ?? 1,
    pullRate: overrides.pullRate ?? 4,
  };
}

function thread(id: number, color: Color, dir: Thread['dir'], length: number, x: number, y: number): Thread {
  return { id, color, dir, length, gridPos: { x, y } };
}

// ── Tap legality ────────────────────────────────────────────────────

describe('tapThread — legality', () => {
  it('slides a thread off a clear corridor into the leftmost free slot', () => {
    const s = makeState({ threads: [thread(1, 'red', 'right', 2, 0, 0)] });
    const next = tapThread(s, 1);
    expect(next).not.toBe(s);
    expect(next.board.threads).toHaveLength(0);
    expect(next.slots[0]).toEqual({ color: 'red', capacity: 2, pulled: 0 });
    expect(next.slots.slice(1)).toEqual([null, null, null]);
  });

  it('fills the LEFTMOST free slot, not the first index', () => {
    const s = makeState({
      threads: [thread(1, 'green', 'right', 1, 0, 0)],
      slots: [spool('red', 1), null, spool('blue', 1), null],
    });
    const next = tapThread(s, 1);
    expect(next.slots[1]).toEqual({ color: 'green', capacity: 1, pulled: 0 });
  });

  it('is a no-op (same reference) when the exit path is blocked by another thread', () => {
    // red wants to slide right but green sits in its corridor at (3,0).
    const s = makeState({
      threads: [thread(1, 'red', 'right', 2, 0, 0), thread(2, 'green', 'up', 1, 3, 0)],
    });
    expect(tapLegality(s, 1)).toBe('blocked');
    expect(canTapThread(s, 1)).toBe(false);
    expect(tapThread(s, 1)).toBe(s);
    // The blocker itself can move (its own corridor upward is clear — it is at the top edge already? no: y=0 => nothing above, exits immediately).
    expect(tapLegality(s, 2)).toBe('ok');
  });

  it('blocks a cross-oriented thread and clears once the blocker leaves', () => {
    // vertical blue at col 2 rows 1..2 blocks horizontal red exiting right on row 1.
    const s = makeState({
      threads: [thread(1, 'red', 'right', 2, 0, 1), thread(2, 'blue', 'down', 2, 2, 1)],
      rows: 4,
    });
    expect(tapLegality(s, 1)).toBe('blocked');
    const afterBlue = tapThread(s, 2); // blue slides down and off
    expect(tapLegality(afterBlue, 1)).toBe('ok');
  });

  it('rejects a tap when all 4 slots are full (slot overflow)', () => {
    const s = makeState({
      threads: [thread(1, 'red', 'right', 1, 0, 0)],
      slots: [spool('red', 1), spool('blue', 1), spool('green', 1), spool('yellow', 1)],
    });
    expect(tapLegality(s, 1)).toBe('slots-full');
    expect(tapThread(s, 1)).toBe(s);
  });

  it('rejects unknown threads and taps after the game is over', () => {
    const s = makeState({ threads: [thread(1, 'red', 'right', 1, 0, 0)] });
    expect(tapLegality(s, 99)).toBe('not-found');
    expect(tapLegality({ ...s, status: 'won' }, 1)).toBe('not-playing');
  });
});

// ── Visibility & pull targeting ─────────────────────────────────────

describe('pull targeting', () => {
  it('visibleSections exposes exactly the front K', () => {
    const s = makeState({ sections: sections('red', 'blue', 'green', 'yellow'), window: 2 });
    expect(visibleSections(s).map((x) => x.color)).toEqual(['red', 'blue']);
  });

  it('pulls the CLOSEST (front-most) visible matching section', () => {
    // reds at index 1 and 3; window covers all; a red spool must take index 1.
    const s = makeState({
      sections: sections('blue', 'red', 'green', 'red'),
      slots: [spool('red', 1), null, null, null],
      window: 4,
      pullRate: 1,
    });
    const next = tick(s, 1); // exactly one pull round
    expect(next.dragon.sections.map((x) => x.color)).toEqual(['blue', 'green', 'red']);
  });

  it('ignores matches beyond the K window (spool idles → dragon advances)', () => {
    // red only at index 3, but window is 3 → not visible.
    const s = makeState({
      sections: sections('blue', 'blue', 'blue', 'red'),
      slots: [spool('red', 1), null, null, null],
      window: 3,
    });
    expect(hasActivePull(s)).toBe(false);
    expect(activeSlots(s)).toEqual([]);
    const next = tick(s, 1);
    expect(next.dragon.headProgress).toBeCloseTo(1); // advanced, did not pull
    expect(next.dragon.sections).toHaveLength(4);
  });

  it('closes the gap on a middle pull, changing adjacencies', () => {
    const s = makeState({
      sections: sections('red', 'blue', 'red', 'green', 'blue'),
      slots: [spool('red', 1), null, null, null],
      window: 3,
      pullRate: 1,
    });
    expect(visibleSections(s).map((x) => x.color)).toEqual(['red', 'blue', 'red']);
    const next = tick(s, 1);
    // front red spliced out, tail shifts forward → new window & adjacency.
    expect(next.dragon.sections.map((x) => x.color)).toEqual(['blue', 'red', 'green', 'blue']);
    expect(visibleSections(next).map((x) => x.color)).toEqual(['blue', 'red', 'green']);
  });
});

// ── Tick: pull-hold vs advance ──────────────────────────────────────

describe('tick — pull-hold vs advance', () => {
  it('advances the dragon when no pull is active', () => {
    const s = makeState({ sections: sections('red'), slots: [spool('blue', 1), null, null, null], speed: 2 });
    const next = tick(s, 0.5);
    expect(next.dragon.headProgress).toBeCloseTo(1);
  });

  it('holds the dragon in place while any pull is active (shortens instead)', () => {
    const s = makeState({
      sections: sections('red', 'red', 'red'),
      slots: [spool('red', 3), null, null, null],
      speed: 2,
      pullRate: 1,
    });
    const next = tick(s, 0.5); // pull active → no advance; 0.5 round accumulates, no whole pull yet
    expect(next.dragon.headProgress).toBe(0);
    expect(next.dragon.pullAccumulator).toBeCloseTo(0.5);
    expect(next.dragon.sections).toHaveLength(3); // sub-threshold: held but nothing pulled yet
  });

  it('resolves closest-to-finish first when two spools of a color compete', () => {
    // Two red spools: one 1-from-done, one 2-from-done; only enough visible red
    // that ordering decides who completes. remaining: A=1, B=2.
    const s = makeState({
      sections: sections('red', 'red', 'red'),
      slots: [spool('red', 3, 1) /* B: rem2 */, spool('red', 2, 1) /* A: rem1 */, null, null],
      window: 3,
      pullRate: 1,
    });
    const next = tick(s, 1); // one round: A (rem1) pulls first and completes, then B pulls one
    expect(next.slots[1]).toBeNull(); // A completed
    expect(next.slots[0]).toEqual({ color: 'red', capacity: 3, pulled: 2 }); // B pulled one
    expect(next.dragon.sections).toHaveLength(1);
  });
});

// ── Win / fail ──────────────────────────────────────────────────────

describe('tick — win & fail', () => {
  it('wins when the board is empty and the last spool completes (dragon consumed)', () => {
    const s = makeState({
      threads: [],
      sections: sections('red', 'red'),
      slots: [spool('red', 2), null, null, null],
      window: 4,
      pullRate: 4,
    });
    const next = tick(s, 1); // 4 rounds available; 2 reds pulled → spool completes
    expect(next.status).toBe('won');
    expect(next.slots.every((x) => x === null)).toBe(true);
    expect(next.dragon.sections).toHaveLength(0);
  });

  it('does NOT win while threads remain on the board', () => {
    const s = makeState({
      threads: [thread(1, 'red', 'right', 1, 0, 0)],
      sections: sections('red'),
      slots: [spool('red', 1), null, null, null],
      window: 4,
    });
    const next = tick(s, 1);
    expect(next.status).toBe('playing');
  });

  it('fails when the head reaches the cat (trackLength) with no pull to hold it', () => {
    const s = makeState({
      sections: sections('red'),
      slots: [spool('blue', 1), null, null, null], // blue idles vs a red dragon
      trackLength: 3,
      speed: 1,
    });
    let cur = s;
    for (let i = 0; i < 3; i += 1) cur = tick(cur, 1);
    expect(cur.dragon.headProgress).toBeGreaterThanOrEqual(3);
    expect(cur.status).toBe('failed');
  });

  it('teal-death: 4 spools whose color lives only past the window lose to the clock', () => {
    // Board cleared, all 4 slots teal, but the visible window is red/blue/green;
    // teal sits at the unseen tail → no pull ever fires → the dragon advances to fail.
    const s = makeState({
      threads: [],
      sections: sections('red', 'blue', 'green', 'teal', 'teal', 'teal', 'teal'),
      slots: [spool('teal', 1), spool('teal', 1), spool('teal', 1), spool('teal', 1)],
      window: 3,
      trackLength: 5,
      speed: 1,
    });
    expect(hasActivePull(s)).toBe(false);
    let cur = s;
    for (let i = 0; i < 5; i += 1) cur = tick(cur, 1);
    expect(cur.status).toBe('failed');
    // The teal spools kept their slots and progress the whole time (idle).
    expect(cur.slots.every((x) => x !== null && x.pulled === 0)).toBe(true);
  });

  it('is a no-op once the game is over', () => {
    const won = makeState({ sections: [] });
    const over: GameState = { ...won, status: 'won' };
    expect(tick(over, 1)).toBe(over);
  });
});

// ── Determinism ─────────────────────────────────────────────────────

describe('determinism', () => {
  it('same (taps, dt) sequence → identical end state', () => {
    const build = () =>
      makeState({
        threads: [
          thread(1, 'red', 'right', 2, 0, 0),
          thread(2, 'blue', 'right', 1, 0, 1),
          thread(3, 'red', 'right', 1, 0, 2),
        ],
        sections: sections('red', 'blue', 'red', 'red'),
        window: 4,
        pullRate: 2,
        speed: 1,
      });

    const run = (s0: GameState): GameState => {
      let s = s0;
      s = tapThread(s, 1);
      s = tick(s, 0.7);
      s = tapThread(s, 2);
      s = tick(s, 1.3);
      s = tapThread(s, 3);
      s = tick(s, 2);
      s = tick(s, 0.5);
      return s;
    };

    expect(run(build())).toEqual(run(build()));
  });
});
