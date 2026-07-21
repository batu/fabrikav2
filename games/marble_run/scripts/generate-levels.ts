/**
 * Level driver: writes src/levels/levels.generated.ts.
 * Run via `npm run gen:levels` (tsx). Seeded and deterministic — a rerun
 * reproduces the identical file.
 *
 * Difficulty schedule (refs/"basic diff funnel - Sheet1.csv" + design
 * session 2026-07-21): levels 1-11 are a linear onboarding ramp (diff
 * 1→10), then a 19-level cycle repeats ad infinitum:
 *
 *   band band RELAX band SPIKE recover band band band SPIKE recover
 *   band band band SPIKE recover band band CLIMAX
 *
 *   band    11-15 (+1 per cycle, capped +3)
 *   spike   16-18 (+1 per cycle, capped +2)
 *   relax    5-10  — fixed forever, never scales
 *   recover  ~7    — fixed forever ("blast through it" payoff)
 *   climax  19-20
 *
 * The first three levels of every cycle after the first sit where the
 * post-climax recovery ramp lands: relax/recover slots keep them easy
 * (the 5→7→10 re-entry is expressed by the cycle's own easy slots).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mulberry32 } from '@fabrikav2/kernel';
import { generateLevel, type GenerateParams } from '../src/puzzle/marble-board/generate';
import { solveLevel } from '../src/puzzle/marble-board/solver';
import type { GateDef, LevelDef, MarbleColor } from '../src/puzzle/marble-board/types';

const LEVEL_COUNT = 50;

// ---------------------------------------------------------------- schedule

type Slot = 'band' | 'spike' | 'recover' | 'ramp';

const CYCLE: readonly Slot[] = [
  'ramp', 'ramp', 'ramp', // post-climax re-entry: 5 → 7 → 10
  'band', 'spike', 'recover',
  'band', 'band', 'band', 'spike', 'recover',
  'band', 'band', 'band', 'spike', 'recover',
  'band', 'band', 'spike', // last spike of the cycle IS the climax
];

/** Target difficulty (1-20) for a 1-based level id. */
function difficultyFor(id: number, rand: () => number): number {
  if (id <= 11) return Math.max(1, id - 1); // onboarding staircase

  const pos = (id - 12) % CYCLE.length;
  const cycle = Math.floor((id - 12) / CYCLE.length);
  const creep = Math.min(cycle, 3); // bands/spikes drift up, capped
  const slot = CYCLE[pos]!;

  switch (slot) {
    case 'ramp': {
      // First cycle has no preceding climax: treat ramp slots as band/relax
      // so levels 12-14 match the funnel chart (band band relax).
      if (cycle === 0) return pos === 2 ? 5 + Math.floor(rand() * 6) : 11 + Math.floor(rand() * 5);
      return [5, 7, 10][pos]!; // fixed forever
    }
    case 'recover':
      return 7; // fixed forever
    case 'spike': {
      const climax = pos === CYCLE.length - 1;
      if (climax) return 19 + Math.floor(rand() * 2); // 19-20
      return Math.min(18, 16 + Math.floor(rand() * 3) + creep);
    }
    case 'band':
      return Math.min(18, 11 + Math.floor(rand() * 5) + creep);
  }
}

// ------------------------------------------------- difficulty → generator

interface Tier {
  readonly cols: number;
  readonly rows: number;
  readonly colors: number;
  readonly fill: number; // fraction of playable cells to fill with marbles
  readonly minWaves: number;
  readonly minOpeners: number;
  readonly gateCount: number;
  readonly sculpt: boolean; // allow voids/plugs
}

/** Piecewise-linear knobs per difficulty 1-20. */
function tierFor(diff: number): Tier {
  const t = (diff - 1) / 19; // 0..1
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    cols: Math.round(lerp(4, 12)),
    rows: Math.round(lerp(4, 14)),
    colors: Math.min(6, 2 + Math.floor(diff / 3.5)),
    fill: lerp(0.35, 0.72),
    minWaves: Math.max(2, Math.round(lerp(2, 14))),
    minOpeners: lerp(0.5, 0.05),
    gateCount: Math.min(8, 2 + Math.floor(diff / 3)),
    sculpt: diff >= 8,
  };
}

// -------------------------------------------------------- board sculpting

function centerVoid(cols: number, rows: number, w: number, h: number): string[] {
  const x0 = Math.floor((cols - w) / 2);
  const y0 = Math.floor((rows - h) / 2);
  const out: string[] = [];
  for (let y = y0; y < y0 + h; y += 1)
    for (let x = x0; x < x0 + w; x += 1) out.push(`${x},${y}`);
  return out;
}

function corners(cols: number, rows: number): string[] {
  return ['0,0', `${cols - 1},0`, `0,${rows - 1}`, `${cols - 1},${rows - 1}`];
}

function buildShape(tier: Tier, rand: () => number): string[] | undefined {
  if (!tier.sculpt) return undefined;
  const { cols, rows } = tier;
  const grid = Array.from({ length: rows }, () => '.'.repeat(cols).split(''));
  const put = (list: string[], ch: string) => {
    for (const spec of list) {
      const [x, y] = spec.split(',').map(Number);
      grid[y!]![x!] = ch;
    }
  };
  const motif = Math.floor(rand() * 4);
  if (motif === 0) put(corners(cols, rows), '#');
  if (motif === 1) put(centerVoid(cols, rows, 2 + Math.floor(rand() * 2), 2 + Math.floor(rand() * 2)), '#');
  if (motif === 2) {
    put(corners(cols, rows), '#');
    put(centerVoid(cols, rows, 2, 2), 'X');
  }
  if (motif === 3) {
    const px = 1 + Math.floor(rand() * (cols - 2));
    const py = 1 + Math.floor(rand() * (rows - 2));
    put([`${px},${py}`, `${cols - 1 - px},${rows - 1 - py}`], 'X');
  }
  return grid.map((r) => r.join(''));
}

// --------------------------------------------------------------- gates

const ALL: readonly MarbleColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

function buildGates(tier: Tier, colors: readonly MarbleColor[], rand: () => number): GateDef[] {
  // Spread gates across sides; index avoids corners so sculpted corner
  // voids never swallow a gate mouth.
  const sides: GateDef['side'][] = ['top', 'bottom', 'left', 'right'];
  const gates: GateDef[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (gates.length < tier.gateCount && guard < 200) {
    guard += 1;
    const side = sides[gates.length % sides.length]!;
    const span = side === 'top' || side === 'bottom' ? tier.cols : tier.rows;
    const index = 1 + Math.floor(rand() * (span - 2));
    const key = `${side}:${index}`;
    if (used.has(key)) continue;
    used.add(key);
    // Every color appears at least once before colors repeat.
    const color = gates.length < colors.length ? colors[gates.length]! : colors[Math.floor(rand() * colors.length)]!;
    gates.push({ side, index, color });
  }
  return gates;
}

// --------------------------------------------------------------- driver

const levels: LevelDef[] = [];
const report: string[] = [];

for (let id = 1; id <= LEVEL_COUNT; id += 1) {
  const rand = mulberry32(0xbead + id * 7919);
  const diff = difficultyFor(id, rand);
  const tier = tierFor(diff);
  const colors = ALL.slice(0, tier.colors);
  const shape = buildShape(tier, rand);
  const playable = shape
    ? shape.join('').split('').filter((c) => c === '.').length
    : tier.cols * tier.rows;

  const params: GenerateParams = {
    id,
    cols: tier.cols,
    rows: tier.rows,
    shape,
    colors,
    gates: buildGates(tier, colors, rand),
    marbleTarget: Math.round(playable * tier.fill),
    seed: 0xf00d + id * 104729,
    minWaves: tier.minWaves,
    minOpeners: tier.minOpeners,
  };

  const level = generateLevel(params);
  const solved = solveLevel(level);
  if (!solved.solvable) throw new Error(`level ${id} is not solvable`);
  levels.push(level);
  report.push(
    `level ${String(id).padStart(2)}  diff ${String(diff).padStart(2)}  ` +
      `${tier.cols}x${tier.rows}  ${solved.order.length} marbles  ` +
      `${solved.waves.length} waves  ${solved.waves[0]} openers`,
  );
}

const header = `/**
 * GENERATED FILE — do not edit by hand. Run \`npm run gen:levels\`.
 * Source of truth: scripts/generate-levels.ts (seeded, deterministic).
 */
import type { LevelDef } from '../engine/types';

export const LEVELS: readonly LevelDef[] = `;

const target = join(dirname(fileURLToPath(import.meta.url)), '../src/levels/levels.generated.ts');
writeFileSync(target, header + JSON.stringify(levels, null, 2) + ';\n');
console.log(report.join('\n'));
console.log(`\nwrote ${levels.length} levels to src/levels/levels.generated.ts`);
