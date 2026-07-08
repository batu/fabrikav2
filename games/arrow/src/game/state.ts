/**
 * GameState — the single mutable top-level game state.
 *
 * The model is the polyline-arrow grid (path.ts). A LevelSpec is an
 * ordered list of Paths on a cols×rows grid; loadLevel places them
 * all. applyTap looks up the owning arrow by cellIndex (tap-anywhere
 * on the body) and resolves the outcome via slitherOutcome.
 *
 * Invariants:
 *   - status ∈ {"idle", "playing", "won", "lost"}
 *   - lives is monotonically non-increasing during a single level
 *   - grid.cellIndex.length === grid.cols * grid.rows
 */

import {
  type Coord,
  type Path,
  type PathDir,
  type PathGrid,
  cellOwner,
  clearPath,
  headDir,
  makePathGrid,
  placePath,
} from "./path.js";
import { slitherOutcome } from "./slither.js";

export type GameStatus = "idle" | "playing" | "won" | "lost";

export const MAX_LIVES = 3;

export interface LevelSpec {
  /** Recipe schema version. Absent = v1 (legacy corpus pre-migration).
   *  Bumped when the YAML/LevelSpec shape changes incompatibly; see
   *  content/level-tools/schema-migrations/README.md. */
  readonly schemaVersion?: 1;
  readonly index: number;
  readonly cols: number;
  readonly rows: number;
  readonly paths: ReadonlyArray<Path>;
  // Pack metadata from the authored recipe corpus. The v2 saga reads these
  // fields directly to derive node order and progress gating.
  readonly pack?: string;
  readonly indexInPack?: number;
  readonly title?: string;
  readonly difficulty?: "easy" | "medium" | "hard";
}

export interface GameState {
  status: GameStatus;
  level: number;
  lives: number;
  grid: PathGrid;
  /** Last collision cell (for the red flash). Null when no recent collision. */
  collisionCell: Coord | null;
  /** Arrow id whose tap failed recently — renders in red with fade.
   *  Null when no failing arrow is active. Cleared when failingT hits 0. */
  failingArrowId: number | null;
  /** Remaining ms the failing arrow should still render red. Decays each
   *  tick from FAIL_PERSIST_MS. Render lerps ink↔error by
   *  (failingT / FAIL_PERSIST_MS) to fade gracefully back to ink. */
  failingT: number;
}

/** How long (ms) a blocked arrow stays tinted red after the collision
 *  anim ends. Matches the reference game's ~2s "this attempt failed"
 *  visual memory. */
export const FAIL_PERSIST_MS = 2000;

export function initialState(): GameState {
  return {
    status: "idle",
    level: 0,
    lives: MAX_LIVES,
    grid: makePathGrid(1, 1),
    collisionCell: null,
    failingArrowId: null,
    failingT: 0,
  };
}

export function loadLevel(state: GameState, spec: LevelSpec): void {
  state.level = spec.index;
  state.lives = MAX_LIVES;
  state.status = "playing";
  state.grid = makePathGrid(spec.cols, spec.rows);
  state.collisionCell = null;
  state.failingArrowId = null;
  state.failingT = 0;
  for (const p of spec.paths) placePath(state.grid, p.id, p.cells);
}

export interface TapResult {
  /** True iff the tap hit an arrow whose slither collides. */
  blocked: boolean;
  /** True iff this tap reduced `lives` to zero (level lost). */
  failed: boolean;
  /** True iff this tap removed the last arrow on the board. */
  completed: boolean;
  /** The arrow id that was activated (for animation callers). */
  arrowId: number;
  /** Path's head cell — launch-anim anchor. */
  head: Coord;
  /** Head direction — needed for FX even when pathAhead is empty
   * (head was already on the exit edge). */
  headDir: PathDir;
  /** Cells the head crosses (head+1 through exit/collision cell).
   * Empty when the head sits on the edge and exits immediately. */
  pathAhead: ReadonlyArray<Coord>;
  /** Collision cell when blocked, null when exiting. */
  collisionAt: Coord | null;
}

/**
 * Apply a tap at grid cell (x, y). Returns null if the cell is empty.
 * When the cell is owned by an arrow, computes the outcome and mutates
 * state: on exit, removes the arrow; on collide, decrements lives and
 * records `collisionCell` (animation/UI consumes it to flash red).
 */
export function applyTap(state: GameState, x: number, y: number): TapResult | null {
  if (state.status !== "playing") return null;
  const ownerId = cellOwner(state.grid, x, y);
  if (ownerId === null) return null;
  const arrow = state.grid.arrows.get(ownerId);
  if (!arrow) return null;

  const outcome = slitherOutcome(state.grid, arrow);
  const head = arrow.cells[arrow.cells.length - 1]!;
  const dir = headDir(arrow);

  if (outcome.kind === "collide") {
    // Lives decrement at tap time (the mistake is committed) but
    // VISUAL feedback (collisionCell, failing tint) is deferred to
    // the impact moment. loop.ts sets those when the anim's
    // impactJustHappened fires, so the red vignette + persistent red
    // sync to the head's visual arrival at the collision cell.
    state.lives = Math.max(0, state.lives - 1);
    const failed = state.lives === 0;
    if (failed) state.status = "lost";
    return {
      blocked: true,
      failed,
      completed: false,
      arrowId: ownerId,
      head,
      headDir: dir,
      pathAhead: outcome.pathAhead,
      collisionAt: outcome.cell,
    };
  }

  // Exit — remove the arrow.
  clearPath(state.grid, ownerId);
  state.collisionCell = null;
  const completed = state.grid.arrows.size === 0;
  if (completed) state.status = "won";
  return {
    blocked: false,
    failed: false,
    completed,
    arrowId: ownerId,
    head,
    headDir: dir,
    pathAhead: outcome.pathAhead,
    collisionAt: null,
  };
}

/** Number of arrows remaining on the board. */
export function arrowsRemaining(state: GameState): number {
  return state.grid.arrows.size;
}
