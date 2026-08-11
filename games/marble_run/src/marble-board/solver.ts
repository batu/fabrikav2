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
  return createLevelSolvabilityChecker(level)(level.cells);
}

export type LevelSolvabilityChecker = (cells: readonly string[]) => boolean;

/** Compile immutable board geometry and reuse its numeric scratch buffers. */
export function createLevelSolvabilityChecker(
  level: Pick<LevelDef, 'cols' | 'rows' | 'gates'>,
): LevelSolvabilityChecker {
  const { cols, rows } = level;
  const size = cols * rows;
  const colorCodes = new Map<MarbleColor, number>();
  const gateMouths: Array<{ readonly code: number; readonly key: number }> = [];
  const mouthFlags = new Uint8Array((level.gates.length + 1) * size);
  for (const gate of level.gates) {
    let code = colorCodes.get(gate.color);
    if (code === undefined) {
      code = colorCodes.size + 1;
      colorCodes.set(gate.color, code);
    }
    const mouth = gateMouthCell(gate, cols, rows);
    const key = mouth.y * cols + mouth.x;
    gateMouths.push({ code, key });
    mouthFlags[code * size + key] = 1;
  }

  const grid = new Int8Array(size);
  const reachable = new Uint8Array((colorCodes.size + 1) * size);
  const queue = new Int16Array(size);
  const movable = new Int16Array(size);

  return (cells: readonly string[]): boolean => {
    let remaining = 0;
    for (let y = 0; y < rows; y += 1) {
      const row = cells[y]!;
      for (let x = 0; x < cols; x += 1) {
        const key = y * cols + x;
        const ch = row[x]!;
        if (ch === '.') {
          grid[key] = 0;
          continue;
        }
        const color = CHAR_TO_COLOR[ch];
        if (!color) {
          grid[key] = -1;
          continue;
        }
        grid[key] = colorCodes.get(color) ?? -2;
        remaining += 1;
      }
    }

    while (remaining > 0) {
      reachable.fill(0);
      for (const gate of gateMouths) {
        if (grid[gate.key] !== 0) continue;
        const offset = gate.code * size;
        if (reachable[offset + gate.key] !== 0) continue;
        let head = 0;
        let tail = 1;
        queue[0] = gate.key;
        reachable[offset + gate.key] = 1;
        while (head < tail) {
          const key = queue[head++]!;
          const x = key % cols;
          const visit = (next: number): void => {
            if (grid[next] !== 0 || reachable[offset + next] !== 0) return;
            reachable[offset + next] = 1;
            queue[tail++] = next;
          };
          if (key >= cols) visit(key - cols);
          if (x + 1 < cols) visit(key + 1);
          if (key + cols < size) visit(key + cols);
          if (x > 0) visit(key - 1);
        }
      }

      let movableCount = 0;
      for (let key = 0; key < size; key += 1) {
        const code = grid[key]!;
        if (code <= 0) continue;
        const offset = code * size;
        const x = key % cols;
        if (
          mouthFlags[offset + key] !== 0 ||
          (key >= cols && reachable[offset + key - cols] !== 0) ||
          (x + 1 < cols && reachable[offset + key + 1] !== 0) ||
          (key + cols < size && reachable[offset + key + cols] !== 0) ||
          (x > 0 && reachable[offset + key - 1] !== 0)
        ) {
          movable[movableCount++] = key;
        }
      }

      if (movableCount === 0) return false;
      for (let index = 0; index < movableCount; index += 1) {
        grid[movable[index]!] = 0;
      }
      remaining -= movableCount;
    }
    return true;
  };
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
