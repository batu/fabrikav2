/**
 * Constructive level generator. Places marbles one at a time onto a
 * board shape, keeping the level solvable after every placement (greedy
 * peel is exact, see solver.ts). Deterministic via a seeded PRNG so a
 * (seed, params) pair always regenerates the same level.
 */
import { mulberry32 } from '@fabrikav2/kernel';
import { solveLevel } from './solver';
import type { GateDef, LevelDef, MarbleColor } from './types';
import { COLOR_TO_CHAR } from './types';

export interface GenerateParams {
  readonly id: number;
  readonly cols: number;
  readonly rows: number;
  /** Board shape rows using '.' playable and '#' void. Optional plugs 'X'. */
  readonly shape?: readonly string[];
  readonly gates: readonly GateDef[];
  readonly colors: readonly MarbleColor[];
  /** How many marbles to place (generator stops early if board jams). */
  readonly marbleTarget: number;
  readonly seed: number;
  readonly hearts?: number;
  /**
   * Difficulty shaping: minimum waves the final level must have.
   * The generator retries placement orders until met (or attempts run out).
   */
  readonly minWaves?: number;
  /**
   * Onboarding shaping: minimum fraction of marbles movable at the
   * start (first wave / total). High = generous opening, low = tight.
   */
  readonly minOpeners?: number;
}

function emptyShape(cols: number, rows: number): string[] {
  return Array.from({ length: rows }, () => '.'.repeat(cols));
}

function setChar(rows: string[], x: number, y: number, ch: string): void {
  rows[y] = rows[y]!.slice(0, x) + ch + rows[y]!.slice(x + 1);
}

export function generateLevel(params: GenerateParams): LevelDef {
  const attempts = 80;
  let best: LevelDef | null = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const rand = mulberry32(params.seed + attempt * 7919);
    const cells = params.shape ? [...params.shape] : emptyShape(params.cols, params.rows);
    const level = tryFill(params, cells, rand);
    if (!level) continue;
    const solved = solveLevel(level);
    if (!solved.solvable) continue; // paranoia — tryFill guarantees solvable
    const waves = solved.waves.length;
    const marbles = solved.order.length;
    const openers = marbles === 0 ? 1 : solved.waves[0]! / marbles;

    const wavesOk = params.minWaves === undefined || waves >= params.minWaves;
    const openersOk = params.minOpeners === undefined || openers >= params.minOpeners;
    if (wavesOk && openersOk) return level;

    // Best-effort fallback: openers constraint dominates (onboarding
    // feel beats dependency depth), then prefer deeper waves.
    const score = (openersOk ? 1000 : openers * 500) + waves;
    if (score > bestScore) {
      best = level;
      bestScore = score;
    }
  }
  if (!best) {
    throw new Error(`generateLevel(${params.id}): could not build a solvable level`);
  }
  return best;
}

function tryFill(
  params: GenerateParams,
  cells: string[],
  rand: () => number,
): LevelDef | null {
  const open: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < params.rows; y += 1) {
    for (let x = 0; x < params.cols; x += 1) {
      if (cells[y]![x] === '.') open.push({ x, y });
    }
  }

  let placed = 0;
  let stall = 0;
  while (placed < params.marbleTarget && open.length > 0 && stall < 250) {
    const idx = Math.floor(rand() * open.length);
    const cell = open[idx]!;
    const color = params.colors[Math.floor(rand() * params.colors.length)]!;
    setChar(cells, cell.x, cell.y, COLOR_TO_CHAR[color]);

    const candidate: LevelDef = {
      id: params.id,
      cols: params.cols,
      rows: params.rows,
      cells: [...cells],
      gates: params.gates,
      hearts: params.hearts,
    };

    if (solveLevel(candidate).solvable) {
      open.splice(idx, 1);
      placed += 1;
      stall = 0;
    } else {
      setChar(cells, cell.x, cell.y, '.');
      stall += 1;
    }
  }

  if (placed === 0) return null;
  return {
    id: params.id,
    cols: params.cols,
    rows: params.rows,
    cells,
    gates: params.gates,
    hearts: params.hearts,
  };
}
