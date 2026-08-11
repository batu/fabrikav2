/**
 * Solvability + difficulty analysis.
 *
 * Key property: removing a marble only frees cells, so open paths never
 * close. Greedy peeling ("repeatedly remove any movable marble") is
 * therefore an EXACT decision procedure for solvability, and the wave
 * structure (how many rounds of parallel peeling) is a stable proxy for
 * how deep the level's dependency chains run.
 */
import { BoardEngine } from './board';
import {
  CHAR_TO_COLOR,
  gateMouthCell,
  type Cell,
  type GateDef,
  type LevelDef,
  type MarbleColor,
} from './types';

export interface SolveResult {
  readonly solvable: boolean;
  /** Marbles per peel wave; length = dependency depth of the level. */
  readonly waves: readonly number[];
  /** A full tap order that clears the board (cells at tap time). */
  readonly order: readonly Cell[];
  /** Marbles still stuck when unsolvable (empty when solvable). */
  readonly stuck: number;
  /**
   * The gate each wave-1 marble exits through, in peel order. Used by
   * the generator's `openerSpread` shaping; later waves need no
   * attribution so they are not recorded.
   */
  readonly firstWaveGates: readonly GateDef[];
}

export function solveLevel(level: LevelDef): SolveResult {
  const engine = new BoardEngine(level);
  const waves: number[] = [];
  const order: Cell[] = [];
  const firstWaveGates: GateDef[] = [];

  while (engine.remainingCount() > 0) {
    const movable = engine.movableMarbles();
    if (movable.length === 0) {
      return {
        solvable: false,
        waves,
        order,
        stuck: engine.remainingCount(),
        firstWaveGates,
      };
    }
    const isFirstWave = waves.length === 0;
    waves.push(movable.length);
    for (const m of movable) {
      // Cells stay valid: marbles never move except by leaving the board.
      order.push(m.cell);
      const change = engine.tap(m.cell);
      if (!change || change.kind !== 'rolled') {
        throw new Error(`Solver invariant broken at ${m.cell.x},${m.cell.y}`);
      }
      if (isFirstWave) firstWaveGates.push(change.gate);
    }
  }
  return { solvable: true, waves, order, stuck: 0, firstWaveGates };
}

/**
 * Exact solvability decision without constructing routes or a tap order.
 *
 * This is the same greedy peel used by `solveLevel`: for each color, flood
 * the empty cells reachable from an open matching gate mouth, then remove
 * every marble touching that region (or already occupying its gate mouth).
 * Removing marbles only opens cells, so peeling all currently movable
 * marbles together is exact.
 *
 * The generator calls this for every tentative placement. Keep the richer
 * `solveLevel` for final candidates, where wave, order, and gate evidence are
 * required.
 */
export function isLevelSolvable(level: LevelDef): boolean {
  const cells = level.cells.map((row) => [...row]);
  let remaining = 0;
  for (const row of cells) {
    for (const ch of row) {
      if (CHAR_TO_COLOR[ch]) remaining += 1;
    }
  }

  while (remaining > 0) {
    const reachableByColor = new Map<MarbleColor, Set<number>>();
    const gateMouthsByColor = new Map<MarbleColor, Set<number>>();

    for (const gate of level.gates) {
      const mouth = gateMouthCell(gate, level.cols, level.rows);
      const key = mouth.y * level.cols + mouth.x;
      let mouths = gateMouthsByColor.get(gate.color);
      if (!mouths) {
        mouths = new Set<number>();
        gateMouthsByColor.set(gate.color, mouths);
      }
      mouths.add(key);

      if (cells[mouth.y]?.[mouth.x] !== '.') continue;
      let reachable = reachableByColor.get(gate.color);
      if (!reachable) {
        reachable = new Set<number>();
        reachableByColor.set(gate.color, reachable);
      }
      floodEmptyCells(cells, level.cols, level.rows, mouth, reachable);
    }

    const movable: Cell[] = [];
    for (let y = 0; y < level.rows; y += 1) {
      for (let x = 0; x < level.cols; x += 1) {
        const color = CHAR_TO_COLOR[cells[y]![x]!];
        if (!color) continue;
        const key = y * level.cols + x;
        if (gateMouthsByColor.get(color)?.has(key)) {
          movable.push({ x, y });
          continue;
        }
        const reachable = reachableByColor.get(color);
        if (!reachable) continue;
        if (
          (y > 0 && reachable.has(key - level.cols)) ||
          (x + 1 < level.cols && reachable.has(key + 1)) ||
          (y + 1 < level.rows && reachable.has(key + level.cols)) ||
          (x > 0 && reachable.has(key - 1))
        ) {
          movable.push({ x, y });
        }
      }
    }

    if (movable.length === 0) return false;
    for (const cell of movable) cells[cell.y]![cell.x] = '.';
    remaining -= movable.length;
  }

  return true;
}

function floodEmptyCells(
  cells: readonly (readonly string[])[],
  cols: number,
  rows: number,
  start: Cell,
  reachable: Set<number>,
): void {
  const startKey = start.y * cols + start.x;
  if (reachable.has(startKey)) return;
  reachable.add(startKey);
  const queue: number[] = [startKey];

  for (let head = 0; head < queue.length; head += 1) {
    const key = queue[head]!;
    const x = key % cols;
    const y = Math.floor(key / cols);
    const visit = (nx: number, ny: number): void => {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || cells[ny]![nx] !== '.') return;
      const nextKey = ny * cols + nx;
      if (reachable.has(nextKey)) return;
      reachable.add(nextKey);
      queue.push(nextKey);
    };
    visit(x, y - 1);
    visit(x + 1, y);
    visit(x, y + 1);
    visit(x - 1, y);
  }
}

export interface DifficultyReport {
  readonly marbles: number;
  readonly colors: number;
  readonly waves: number;
  /** Fraction of marbles movable at the start — lower = tighter opening. */
  readonly initialMovableFraction: number;
}

export function analyzeDifficulty(level: LevelDef): DifficultyReport {
  const solved = solveLevel(level);
  if (!solved.solvable) {
    throw new Error(`Level ${level.id} is not solvable`);
  }
  const engine = new BoardEngine(level);
  const marbles = engine.remainingCount();
  const colors = new Set(engine.allMarbles().map((m) => m.color)).size;
  return {
    marbles,
    colors,
    waves: solved.waves.length,
    initialMovableFraction: marbles === 0 ? 1 : solved.waves[0]! / marbles,
  };
}
