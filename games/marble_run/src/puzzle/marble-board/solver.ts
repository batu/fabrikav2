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
import type { Cell, LevelDef } from './types';

export interface SolveResult {
  readonly solvable: boolean;
  /** Marbles per peel wave; length = dependency depth of the level. */
  readonly waves: readonly number[];
  /** A full tap order that clears the board (cells at tap time). */
  readonly order: readonly Cell[];
  /** Marbles still stuck when unsolvable (empty when solvable). */
  readonly stuck: number;
}

export function solveLevel(level: LevelDef): SolveResult {
  const engine = new BoardEngine(level);
  const waves: number[] = [];
  const order: Cell[] = [];

  while (engine.remainingCount() > 0) {
    const movable = engine.movableMarbles();
    if (movable.length === 0) {
      return { solvable: false, waves, order, stuck: engine.remainingCount() };
    }
    waves.push(movable.length);
    for (const m of movable) {
      // Cells stay valid: marbles never move except by leaving the board.
      order.push(m.cell);
      const change = engine.tap(m.cell);
      if (!change || change.kind !== 'rolled') {
        throw new Error(`Solver invariant broken at ${m.cell.x},${m.cell.y}`);
      }
    }
  }
  return { solvable: true, waves, order, stuck: 0 };
}
