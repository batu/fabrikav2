/**
 * Move history — push-before-move, pop-to-undo.
 *
 * Specimen refs: R10 (undo), R11 (reset).
 *
 * Snapshots capture the remaining arrows (by id and cells) plus
 * lives. Restore rebuilds the grid by re-placing those paths. The
 * stack is capped at 16 frames to prevent unbounded growth on long
 * sessions.
 */

import type { GameState } from "./state.js";
import { type Path, makePathGrid, placePath } from "./path.js";

export interface StateSnapshot {
  readonly lives: number;
  readonly arrows: ReadonlyArray<Path>;
}

const HISTORY_CAP = 16;

export function snapshot(state: GameState): StateSnapshot {
  // Paths are immutable Readonly structures; a shallow copy of the
  // values suffices. Cells arrays are ReadonlyArray so no deep clone.
  const arrows: Path[] = [...state.grid.arrows.values()];
  return { lives: state.lives, arrows };
}

export function restore(state: GameState, snap: StateSnapshot): void {
  const { cols, rows } = state.grid;
  state.grid = makePathGrid(cols, rows);
  state.collisionCell = null;
  for (const p of snap.arrows) placePath(state.grid, p.id, p.cells);
  state.lives = snap.lives;
  // lives<=0 takes precedence over arrows-empty. Not reachable under
  // current applyTap (lives only drops on blocked taps, which never
  // clear an arrow), but future mechanics that mix damage and clearing
  // in one tick would otherwise silently restore a losing snapshot as
  // 'won'. Using <= instead of == also tolerates removal of the
  // Math.max(0, ...) clamp in state.ts without a silent regression.
  if (snap.lives <= 0) {
    state.status = "lost";
  } else if (snap.arrows.length === 0) {
    state.status = "won";
  } else {
    state.status = "playing";
  }
}

export class History {
  private stack: StateSnapshot[] = [];
  private initial: StateSnapshot | null = null;

  markInitial(state: GameState): void {
    this.initial = snapshot(state);
    this.stack.length = 0;
  }

  push(state: GameState): void {
    this.stack.push(snapshot(state));
    if (this.stack.length > HISTORY_CAP) this.stack.shift();
  }

  /** Returns true iff an undo was applied. */
  undo(state: GameState): boolean {
    const prev = this.stack.pop();
    if (!prev) return false;
    restore(state, prev);
    return true;
  }

  reset(state: GameState): void {
    if (!this.initial) return;
    restore(state, this.initial);
    this.stack.length = 0;
  }

  get canUndo(): boolean {
    return this.stack.length > 0;
  }
}
