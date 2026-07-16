/**
 * v0 level content — hand-authored thread maps (level-as-data; the dragon is
 * derived, so a level IS its thread map plus tuning dials). Ramp per the
 * product contract: ~6 threads/3 colors → ~10/4 → ~14/5, difficulty also
 * tightening via the visibility window and dragon speed.
 *
 * Maps are validated by unit tests: in-bounds, overlap-free, conservation,
 * and winnable by a simulated greedy player.
 */

import type { ThreadDef, WoolLevelDef } from './types';

function t(id: string, color: ThreadDef['color'], x: number, y: number, length: number, dir: ThreadDef['dir']): ThreadDef {
  return { id, color, x, y, length, dir };
}

/** Level 1 — first-time-player friendly: most threads free immediately,
 *  generous window, slow dragon. 6 threads / 3 colors / 11 sections. */
export const LEVEL_1: WoolLevelDef = {
  cols: 6,
  rows: 4,
  visibleWindow: 6,
  dragonSpeed: 0.32,
  pullRate: 1.4,
  trackLength: 16,
  seed: 101,
  threads: [
    t('t1', 'red', 0, 0, 2, 'right'),
    t('t2', 'blue', 3, 0, 2, 'right'),
    t('t3', 'green', 0, 1, 2, 'left'),
    t('t4', 'red', 3, 1, 1, 'down'),
    t('t5', 'blue', 1, 2, 2, 'right'),
    t('t6', 'green', 4, 3, 2, 'right'),
  ],
};

/** Level 2 — blocking chains appear; 10 threads / 4 colors / 19 sections. */
export const LEVEL_2: WoolLevelDef = {
  cols: 6,
  rows: 5,
  visibleWindow: 5,
  dragonSpeed: 0.42,
  pullRate: 1.4,
  trackLength: 20,
  seed: 202,
  threads: [
    t('a', 'red', 0, 0, 2, 'right'),
    t('b', 'blue', 2, 0, 1, 'down'),
    t('c', 'green', 4, 0, 2, 'right'),
    t('d', 'yellow', 0, 1, 2, 'down'),
    t('e', 'blue', 2, 1, 2, 'right'),
    t('f', 'red', 4, 2, 2, 'left'),
    t('g', 'green', 1, 3, 3, 'right'),
    t('h', 'yellow', 5, 3, 1, 'down'),
    t('i', 'blue', 0, 4, 2, 'right'),
    t('j', 'yellow', 3, 4, 2, 'right'),
  ],
};

/** Level 3 — real sequencing: tight window, faster dragon, 5 colors,
 *  14 threads / 26 sections. */
export const LEVEL_3: WoolLevelDef = {
  cols: 6,
  rows: 6,
  visibleWindow: 4,
  dragonSpeed: 0.5,
  pullRate: 1.4,
  trackLength: 22,
  seed: 303,
  threads: [
    t('a', 'red', 0, 0, 2, 'right'),
    t('b', 'purple', 3, 0, 1, 'down'),
    t('c', 'blue', 4, 0, 2, 'right'),
    t('d', 'green', 0, 1, 2, 'down'),
    t('e', 'yellow', 2, 1, 2, 'right'),
    t('f', 'red', 5, 1, 2, 'down'),
    t('g', 'blue', 1, 2, 2, 'right'),
    t('h', 'purple', 4, 2, 1, 'right'),
    t('i', 'green', 0, 3, 3, 'right'),
    t('j', 'yellow', 4, 3, 2, 'down'),
    t('k', 'blue', 0, 4, 1, 'down'),
    t('l', 'red', 1, 4, 2, 'right'),
    t('m', 'green', 0, 5, 2, 'right'),
    t('n', 'purple', 3, 5, 2, 'right'),
  ],
};

export const WOOL_LEVELS: WoolLevelDef[] = [LEVEL_1, LEVEL_2, LEVEL_3];

/** Map a shell level id (stub_level_01…) to a wool map. Beyond the 3 authored
 *  maps, cycle them with a per-level seed so later saga nodes replay the maps
 *  with fresh dragon orders (v0 contract is 3 levels; the shell ships 15
 *  saga nodes, so the cycle keeps every node playable). */
export function woolLevelForShellId(levelId: string): WoolLevelDef {
  const m = levelId.match(/(\d+)/);
  const n = m ? parseInt(m[1], 10) : 1;
  const base = WOOL_LEVELS[(n - 1) % WOOL_LEVELS.length];
  return { ...base, seed: base.seed + Math.floor((n - 1) / WOOL_LEVELS.length) * 7919 };
}

/** Structural validation used by tests (and available to tools). */
export function validateLevel(def: WoolLevelDef): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const th of def.threads) {
    const cells =
      th.dir === 'left' || th.dir === 'right'
        ? Array.from({ length: th.length }, (_, i) => ({ x: th.x + i, y: th.y }))
        : Array.from({ length: th.length }, (_, i) => ({ x: th.x, y: th.y + i }));
    for (const c of cells) {
      if (c.x < 0 || c.y < 0 || c.x >= def.cols || c.y >= def.rows) {
        problems.push(`${th.id}: cell (${c.x},${c.y}) out of bounds`);
      }
      const key = `${c.x},${c.y}`;
      const owner = seen.get(key);
      if (owner) problems.push(`${th.id}: cell (${c.x},${c.y}) overlaps ${owner}`);
      seen.set(key, th.id);
    }
  }
  return problems;
}
