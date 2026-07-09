/**
 * Wool Crush v0 levels — level-as-data (fabrikav2 house pattern; same spirit as
 * marble_run's LevelDef grid strings). A level is defined by its thread map
 * ALONE: the dragon is DERIVED from it (one section per unit of thread length,
 * conserved per color, then shuffled deterministically by the level seed). That
 * derivation is the conservation invariant the kernel is tested against.
 *
 * Content, not contract: grid sizes, thread counts, window (K), speed, pullRate
 * and trackLength are tuning numbers. Difficulty ramps mainly via `window` — a
 * smaller visibility window = tighter scarcity = real sequencing (L3), while a
 * window covering the whole dragon (L1) removes scarcity and is trivially
 * winnable.
 */

import { mulberry32, shuffle } from './rng.ts';
import type { Color, Direction, DragonSection, GameState, GridPos, Thread } from './types.ts';

export interface ThreadSpec {
  readonly color: Color;
  readonly dir: Direction;
  readonly length: number;
  readonly gridPos: GridPos;
}

export interface LevelDef {
  readonly id: number;
  readonly cols: number;
  readonly rows: number;
  /** K — the front sections that are visible/pullable (the scarcity window). */
  readonly window: number;
  /** Dragon forward speed (track units / second). */
  readonly speed: number;
  /** Pull rounds / second while a pull is active. */
  readonly pullRate: number;
  /** Distance the head travels to reach the cat (fail). */
  readonly trackLength: number;
  /** Seed for the deterministic dragon shuffle. */
  readonly seed: number;
  readonly threads: readonly ThreadSpec[];
}

/**
 * Build the dragon from a thread map: one section per unit of length (so
 * sections-per-color == total thread length per color — conservation holds by
 * construction, before AND after the shuffle, since a shuffle is a permutation),
 * then shuffle deterministically by `seed`.
 */
export function buildDragon(threads: readonly ThreadSpec[], seed: number): DragonSection[] {
  const raw: DragonSection[] = [];
  for (const t of threads) {
    for (let k = 0; k < t.length; k += 1) raw.push({ color: t.color });
  }
  return shuffle(raw, mulberry32(seed));
}

/** Total thread length per color — the conserved quantity per level. */
export function colorTotals(threads: readonly ThreadSpec[]): Map<Color, number> {
  const totals = new Map<Color, number>();
  for (const t of threads) totals.set(t.color, (totals.get(t.color) ?? 0) + t.length);
  return totals;
}

/** Fresh initial state for a level: threads placed, dragon derived, 4 empty slots. */
export function createLevelState(level: LevelDef): GameState {
  const threads: Thread[] = level.threads.map((t, i) => ({
    id: i + 1,
    color: t.color,
    dir: t.dir,
    length: t.length,
    gridPos: { x: t.gridPos.x, y: t.gridPos.y },
  }));

  return {
    status: 'playing',
    levelId: level.id,
    board: { cols: level.cols, rows: level.rows, threads },
    slots: [null, null, null, null],
    dragon: {
      sections: buildDragon(level.threads, level.seed),
      headProgress: 0,
      trackLength: level.trackLength,
      window: level.window,
      pullAccumulator: 0,
    },
    speed: level.speed,
    pullRate: level.pullRate,
  };
}

// ── The 3 shipped levels ────────────────────────────────────────────

/**
 * L1 — 6 threads / 3 colors, trivially winnable. Every thread sits in its own
 * row with a clear corridor to the right edge, and the window covers the whole
 * dragon (no scarcity): any release order that keeps slots fed wins.
 */
const LEVEL_1: LevelDef = {
  id: 1,
  cols: 6,
  rows: 6,
  window: 12, // ≥ dragon length (9) → whole dragon visible
  speed: 1,
  pullRate: 4,
  trackLength: 100,
  seed: 1,
  threads: [
    { color: 'red', dir: 'right', length: 2, gridPos: { x: 0, y: 0 } },
    { color: 'blue', dir: 'right', length: 2, gridPos: { x: 0, y: 1 } },
    { color: 'green', dir: 'right', length: 2, gridPos: { x: 0, y: 2 } },
    { color: 'red', dir: 'right', length: 1, gridPos: { x: 0, y: 3 } },
    { color: 'blue', dir: 'right', length: 1, gridPos: { x: 0, y: 4 } },
    { color: 'green', dir: 'right', length: 1, gridPos: { x: 0, y: 5 } },
  ],
};

/**
 * L2 — 10 threads / 4 colors, medium window. A vertical yellow thread sits in
 * the exit corridor of the top two rows, so it must be cleared before the reds
 * and blues in rows 0–1 can leave: a first taste of ordering.
 */
const LEVEL_2: LevelDef = {
  id: 2,
  cols: 7,
  rows: 7,
  window: 8,
  speed: 1,
  pullRate: 4,
  trackLength: 100,
  seed: 2,
  threads: [
    { color: 'red', dir: 'right', length: 2, gridPos: { x: 0, y: 0 } },
    { color: 'blue', dir: 'right', length: 2, gridPos: { x: 0, y: 1 } },
    { color: 'green', dir: 'right', length: 2, gridPos: { x: 0, y: 2 } },
    { color: 'yellow', dir: 'right', length: 2, gridPos: { x: 0, y: 3 } },
    { color: 'red', dir: 'right', length: 1, gridPos: { x: 0, y: 4 } },
    { color: 'blue', dir: 'right', length: 1, gridPos: { x: 0, y: 5 } },
    { color: 'green', dir: 'right', length: 1, gridPos: { x: 0, y: 6 } },
    // Vertical yellow occupying (6,0)/(6,1): blocks the row-0 red and row-1 blue
    // corridors until it exits downward (its own corridor (6,2..6) is clear).
    { color: 'yellow', dir: 'down', length: 2, gridPos: { x: 6, y: 0 } },
    { color: 'yellow', dir: 'right', length: 1, gridPos: { x: 2, y: 4 } },
    { color: 'green', dir: 'up', length: 1, gridPos: { x: 3, y: 6 } },
  ],
};

/**
 * L3 — 14 threads / 5 colors, tight window (K=5). Several vertical threads sit
 * across the horizontal exit corridors, so releases must be sequenced AND the
 * narrow window means the color you free must match what is currently visible —
 * free the wrong colors and they idle while the dragon advances (the teal-death
 * shape, generalized).
 */
const LEVEL_3: LevelDef = {
  id: 3,
  cols: 8,
  rows: 8,
  window: 5,
  speed: 1,
  pullRate: 4,
  trackLength: 120,
  seed: 3,
  threads: [
    { color: 'red', dir: 'right', length: 2, gridPos: { x: 0, y: 0 } },
    { color: 'blue', dir: 'right', length: 2, gridPos: { x: 0, y: 1 } },
    { color: 'green', dir: 'right', length: 2, gridPos: { x: 0, y: 2 } },
    { color: 'yellow', dir: 'right', length: 2, gridPos: { x: 0, y: 3 } },
    { color: 'purple', dir: 'right', length: 2, gridPos: { x: 0, y: 4 } },
    { color: 'red', dir: 'right', length: 1, gridPos: { x: 0, y: 5 } },
    { color: 'blue', dir: 'right', length: 1, gridPos: { x: 0, y: 6 } },
    { color: 'green', dir: 'right', length: 1, gridPos: { x: 0, y: 7 } },
    // Verticals crossing the exit corridors → sequencing.
    { color: 'yellow', dir: 'down', length: 2, gridPos: { x: 7, y: 0 } },
    { color: 'purple', dir: 'down', length: 2, gridPos: { x: 6, y: 2 } },
    { color: 'red', dir: 'down', length: 1, gridPos: { x: 5, y: 4 } },
    { color: 'blue', dir: 'up', length: 2, gridPos: { x: 7, y: 5 } },
    { color: 'green', dir: 'down', length: 1, gridPos: { x: 4, y: 6 } },
    { color: 'purple', dir: 'down', length: 1, gridPos: { x: 3, y: 6 } },
  ],
};

export const LEVELS: readonly LevelDef[] = [LEVEL_1, LEVEL_2, LEVEL_3];
