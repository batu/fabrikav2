import { describe, expect, it } from 'vitest';
import { canRelease, createGame, deriveDragon, exitPathCells, nextPullingSlot, tapThread, threadCells, tick } from './engine';
import { LEVEL_1, LEVEL_2, LEVEL_3, WOOL_LEVELS, validateLevel, woolLevelForShellId } from './levels';
import type { WoolLevelDef, WoolState } from './types';
import { SLOT_COUNT } from './types';

/** Tiny fixture: 3x3 board, two threads where one blocks the other. */
const MINI: WoolLevelDef = {
  cols: 3,
  rows: 3,
  visibleWindow: 4,
  dragonSpeed: 1,
  pullRate: 2,
  trackLength: 10,
  seed: 1,
  threads: [
    { id: 'mover', color: 'red', x: 0, y: 0, length: 1, dir: 'right' },
    { id: 'wall', color: 'blue', x: 2, y: 0, length: 1, dir: 'down' },
  ],
};

describe('board geometry', () => {
  it('computes cells along the movement axis', () => {
    expect(threadCells({ id: 'x', color: 'red', x: 1, y: 2, length: 2, dir: 'right' })).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(threadCells({ id: 'x', color: 'red', x: 1, y: 0, length: 2, dir: 'down' })).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it('computes the straight exit path to the board edge', () => {
    expect(exitPathCells({ id: 'x', color: 'red', x: 0, y: 0, length: 1, dir: 'right' }, MINI)).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(exitPathCells({ id: 'x', color: 'red', x: 0, y: 0, length: 1, dir: 'left' }, MINI)).toEqual([]);
  });
});

describe('tap legality (Parking Jam rule)', () => {
  it('blocks a thread whose exit path is occupied, frees it when the blocker leaves', () => {
    let s = createGame(MINI);
    expect(canRelease(s, 'mover')).toBe(false); // wall sits on its row exit
    expect(canRelease(s, 'wall')).toBe(true);

    const blocked = tapThread(s, 'mover');
    expect(blocked.events).toEqual([{ kind: 'blocked', threadId: 'mover' }]);

    s = tapThread(s, 'wall').state;
    expect(canRelease(s, 'mover')).toBe(true);
    const ok = tapThread(s, 'mover');
    expect(ok.events[0]).toEqual({ kind: 'released', threadId: 'mover', slot: 1 });
  });

  it('released threads take the LEFTMOST free slot', () => {
    let s = createGame(MINI);
    s = tapThread(s, 'wall').state; // slot 0
    const r = tapThread(s, 'mover'); // slot 1
    expect(r.events[0]).toMatchObject({ slot: 1 });
  });

  it('is a no-op when all 4 slots are occupied', () => {
    const def: WoolLevelDef = {
      ...MINI,
      cols: 6,
      rows: 5,
      threads: Array.from({ length: 5 }, (_, i) => ({
        id: `f${i}`,
        color: 'red' as const,
        x: 0,
        y: i,
        length: 1,
        dir: 'left' as const,
      })),
    };
    let s = createGame(def);
    for (let i = 0; i < SLOT_COUNT; i += 1) s = tapThread(s, `f${i}`).state;
    expect(s.slots.every((x) => x !== null)).toBe(true);
    const fifth = tapThread(s, 'f4');
    expect(fifth.events).toEqual([{ kind: 'blocked', threadId: 'f4' }]);
    expect(fifth.state.threads).toHaveLength(1);
  });
});

describe('dragon derivation (conservation)', () => {
  it.each(WOOL_LEVELS.map((l, i) => [i + 1, l] as const))('level %d: sections per color == thread length per color', (_n, def) => {
    const dragon = deriveDragon(def);
    const want = new Map<string, number>();
    for (const th of def.threads) want.set(th.color, (want.get(th.color) ?? 0) + th.length);
    const got = new Map<string, number>();
    for (const c of dragon) got.set(c, (got.get(c) ?? 0) + 1);
    expect(Object.fromEntries(got)).toEqual(Object.fromEntries(want));
  });

  it('is deterministic for a seed and different across seeds', () => {
    expect(deriveDragon(LEVEL_1)).toEqual(deriveDragon(LEVEL_1));
    const reseeded = { ...LEVEL_1, seed: LEVEL_1.seed + 1 };
    expect(deriveDragon(reseeded)).not.toEqual(deriveDragon(LEVEL_1));
  });
});

describe('pulling', () => {
  function withDragon(s: WoolState, dragon: WoolState['dragon']): WoolState {
    return { ...s, dragon: dragon.slice() };
  }

  it('pulls the closest VISIBLE matching section and the gap closes', () => {
    let s = createGame(MINI);
    s = tapThread(s, 'wall').state; // blue spool, length 1
    s = withDragon(s, ['red', 'green', 'blue', 'blue', 'red']);
    const r = tick(s, 500); // pullRate 2/s → one section per 500ms
    expect(r.events[0]).toMatchObject({ kind: 'sectionPulled', dragonIndex: 2, color: 'blue' });
    expect(r.state.dragon).toEqual(['red', 'green', 'blue', 'red']); // spliced shut
  });

  it('ignores matches OUTSIDE the visibility window (spool idles, keeps slot)', () => {
    let s = createGame({ ...MINI, visibleWindow: 2 });
    s = tapThread(s, 'wall').state; // blue spool
    s = withDragon(s, ['red', 'green', 'blue', 'blue']);
    const start = s.headProgress;
    const r = tick(s, 1000);
    // No visible blue → no pull; the dragon advanced instead, spool intact.
    expect(r.events).toEqual([]);
    expect(r.state.headProgress).toBeCloseTo(start + 1);
    expect(r.state.slots.filter((x) => x !== null)).toHaveLength(1);
  });

  it('closest-to-finish spool pulls first when several match', () => {
    const def: WoolLevelDef = {
      ...MINI,
      cols: 6,
      rows: 5,
      threads: [
        { id: 'long', color: 'red', x: 0, y: 0, length: 3, dir: 'right' },
        { id: 'short', color: 'blue', x: 0, y: 1, length: 1, dir: 'right' },
      ],
    };
    let s = createGame(def);
    s = tapThread(s, 'long').state;
    s = tapThread(s, 'short').state;
    s = { ...s, dragon: ['red', 'blue', 'red', 'blue', 'red'] };
    const r = tick(s, 500);
    // short (remaining 1) beats long (remaining 3) despite red being at index 0.
    expect(r.events[0]).toMatchObject({ kind: 'sectionPulled', color: 'blue', slot: 1 });
    expect(r.events[1]).toMatchObject({ kind: 'spoolCompleted', slot: 1 });
  });

  it('the dragon holds in place while a pull is active', () => {
    let s = createGame(MINI);
    s = tapThread(s, 'wall').state; // blue spool matches head below
    s = { ...s, dragon: ['blue', 'red', 'red'] };
    const start = s.headProgress;
    const r = tick(s, 500);
    expect(r.state.headProgress).toBe(start); // held — shortened instead
    expect(r.state.dragon).toEqual(['red', 'red']);
  });
});

describe('win / fail', () => {
  it('wins when the board is empty and all spools complete', () => {
    const def: WoolLevelDef = {
      ...MINI,
      threads: [{ id: 'only', color: 'red', x: 0, y: 0, length: 2, dir: 'right' }],
    };
    let s = createGame(def);
    s = tapThread(s, 'only').state;
    const r = tick(s, 2000); // 2 sections @ 2/s = 1s, generous
    expect(r.state.status).toBe('won');
    expect(r.events.at(-1)).toEqual({ kind: 'won' });
    expect(r.state.dragon).toHaveLength(0);
  });

  it('fails when the head reaches the cat (idle spools lose the race)', () => {
    let s = createGame({ ...MINI, trackLength: 3, dragonSpeed: 2, visibleWindow: 1 });
    s = tapThread(s, 'wall').state; // blue spool, but head window is red-only
    s = { ...s, dragon: ['red', 'red', 'blue'] };
    const r = tick(s, 5000);
    expect(r.state.status).toBe('failed');
    expect(r.events.at(-1)).toEqual({ kind: 'failed' });
  });

  it('taps after game over are no-ops', () => {
    let s = createGame({ ...MINI, trackLength: 0.5, dragonSpeed: 10 });
    s = tick(s, 1000).state;
    expect(s.status).toBe('failed');
    const r = tapThread(s, 'wall');
    expect(r.events).toEqual([]);
  });
});

describe('shipped levels', () => {
  it.each(WOOL_LEVELS.map((l, i) => [i + 1, l] as const))('level %d is structurally valid', (_n, def) => {
    expect(validateLevel(def)).toEqual([]);
  });

  it('shell id mapping cycles maps with fresh seeds', () => {
    expect(woolLevelForShellId('stub_level_01').threads).toEqual(LEVEL_1.threads);
    expect(woolLevelForShellId('stub_level_02').threads).toEqual(LEVEL_2.threads);
    expect(woolLevelForShellId('stub_level_03').threads).toEqual(LEVEL_3.threads);
    const fourth = woolLevelForShellId('stub_level_04');
    expect(fourth.threads).toEqual(LEVEL_1.threads);
    expect(fourth.seed).not.toBe(LEVEL_1.seed);
  });

  // Simulated greedy player: whenever a releasable thread's color is visible
  // (or any slot is free and nothing matches), tap the most useful thread;
  // otherwise let time pass. Winning here proves the level is winnable.
  function greedyPlays(def: WoolLevelDef): 'won' | 'failed' {
    let s = createGame(def);
    let guard = 0;
    while (s.status === 'playing' && guard < 5000) {
      guard += 1;
      const visible = new Set(s.dragon.slice(0, Math.min(def.visibleWindow, s.dragon.length)));
      const free = s.slots.some((x) => x === null);
      if (free) {
        const releasable = s.threads.filter((t) => canRelease(s, t.id));
        const useful = releasable.find((t) => visible.has(t.color));
        // Tap a visible-matching thread first; if none, only tap to unblock
        // when we have 2+ free slots (avoid the teal-death self-jam).
        const freeCount = s.slots.filter((x) => x === null).length;
        const pick = useful ?? (freeCount >= 3 ? releasable[0] : undefined);
        if (pick) {
          s = tapThread(s, pick.id).state;
          continue;
        }
      }
      s = tick(s, 100).state;
    }
    return s.status === 'won' ? 'won' : 'failed';
  }

  it.each(WOOL_LEVELS.map((l, i) => [i + 1, l] as const))('level %d is winnable by a greedy player', (_n, def) => {
    expect(greedyPlays(def)).toBe('won');
  });

  it('the teal-death scenario is reproducible: filling slots with tail-only colors loses', () => {
    // Level 3 with a tiny window: release only threads whose colors are NOT
    // in the visible head — all four slots idle and the dragon walks in.
    const def = { ...LEVEL_3, visibleWindow: 2 };
    let s = createGame(def);
    const visible = new Set(s.dragon.slice(0, 2));
    let filled = 0;
    for (const th of def.threads) {
      if (filled >= SLOT_COUNT) break;
      if (!visible.has(th.color) && canRelease(s, th.id)) {
        const r = tapThread(s, th.id);
        if (r.events[0]?.kind === 'released') {
          s = r.state;
          filled += 1;
        }
      }
    }
    if (filled === SLOT_COUNT && nextPullingSlot(s) === -1) {
      const r = tick(s, 10 * 60 * 1000);
      expect(r.state.status).toBe('failed');
    } else {
      // The seeded dragon put every color up front — still a valid level,
      // but the scenario needs manual slots; assert the mechanism directly.
      let manual = createGame(def);
      manual = { ...manual, slots: [
        { color: 'purple', remaining: 1, total: 1 },
        { color: 'purple', remaining: 1, total: 1 },
        { color: 'purple', remaining: 1, total: 1 },
        { color: 'purple', remaining: 1, total: 1 },
      ], dragon: ['red', 'blue', 'green', 'yellow', 'purple'] };
      const r = tick(manual, 10 * 60 * 1000);
      expect(r.state.status).toBe('failed');
    }
  });
});
