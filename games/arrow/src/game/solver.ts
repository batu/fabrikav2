/**
 * Greedy solver for polyline-arrow levels.
 *
 * Algorithm (guide §6): at each state, pop any arrow whose
 * slitherOutcome is "exit". Popping an arrow only opens cells —
 * it never creates a new collision. So if no arrow is free to exit
 * at some state, no amount of reordering earlier moves would help.
 * Therefore greedy is sound and complete.
 *
 * Returns an ordered list of head-cells (the tap locations) that
 * clear the board, or null if unsolvable.
 *
 * Cost: O(N² · max(cols, rows)) worst case — each of N arrows
 * re-scans the remaining set on each pop. Fine for game-level
 * grids (N ≤ ~40).
 */

import {
  type Coord,
  type Path,
  type PathGrid,
  clearPath,
  headCell,
  makePathGrid,
  placePath,
} from "./path.js";
import { slitherOutcome } from "./slither.js";

/**
 * Build a scratch grid from a list of paths and run the greedy solver.
 * The input `paths` are read but not mutated; the scratch grid is
 * discarded.
 */
export function solve(
  cols: number,
  rows: number,
  paths: ReadonlyArray<Path>,
): Coord[] | null {
  const g = makePathGrid(cols, rows);
  for (const p of paths) placePath(g, p.id, p.cells);
  return solveInPlace(g);
}

/**
 * In-place variant: consumes a grid (clearing arrows as it pops) and
 * returns the tap order. On success the grid is emptied. On failure
 * the grid contains only the arrows that could not be cleared —
 * arrows popped before the stall have already been removed.
 */
export function solveInPlace(g: PathGrid): Coord[] | null {
  const order: Coord[] = [];
  // Iteration is bounded by initial arrow count; each iteration
  // removes exactly one arrow or declares failure.
  const initialCount = g.arrows.size;
  for (let step = 0; step < initialCount; step++) {
    let exitArrow: Path | null = null;
    for (const p of g.arrows.values()) {
      if (slitherOutcome(g, p).kind === "exit") {
        exitArrow = p;
        break;
      }
    }
    if (!exitArrow) return null;
    order.push(headCell(exitArrow));
    clearPath(g, exitArrow.id);
  }
  return order;
}

/** True iff the level is solvable as constructed. */
export function validateLevel(
  cols: number,
  rows: number,
  paths: ReadonlyArray<Path>,
): boolean {
  return solve(cols, rows, paths) !== null;
}

/**
 * Count arrows that are currently blocked (slitherOutcome ≠ exit).
 * Used by GEN-3's difficulty dials to enforce a targetBlockedT1 band
 * at generation time.
 */
export function blockedAtTurn1(
  cols: number,
  rows: number,
  paths: ReadonlyArray<Path>,
): number {
  const g = makePathGrid(cols, rows);
  for (const p of paths) placePath(g, p.id, p.cells);
  let blocked = 0;
  for (const p of g.arrows.values()) {
    if (slitherOutcome(g, p).kind !== "exit") blocked++;
  }
  return blocked;
}

/**
 * Count distinct solution orderings up to `cap` (inclusive). Returns 0
 * if unsolvable. Backtracking enumeration: at each state, recurse into
 * every arrow currently exitable. The search is safe to bound because
 * the branching factor at each step is ≤ arrowCount.
 *
 * Used by the DSL's solverCheck knob — Pack 4 (Crowd) and Pack 10
 * (Masterpieces) want puzzles where forced ordering is part of the
 * difficulty; a recipe that admits 50 orderings is too "open."
 */
/** Hard ceiling on recursive calls — the cap prunes at leaves, but a
 *  wide interior subtree can still explode before the first leaf. At
 *  gen-time we call solveCount 200× per recipe × 100 recipes, so a
 *  pathological layout shouldn't spend seconds enumerating orderings. */
const SOLVE_COUNT_NODE_BUDGET = 100_000;

export function solveCount(
  cols: number,
  rows: number,
  paths: ReadonlyArray<Path>,
  cap: number = 8,
): number {
  const g = makePathGrid(cols, rows);
  for (const p of paths) placePath(g, p.id, p.cells);
  let count = 0;
  let nodes = 0;
  const recurse = (): boolean => {
    nodes++;
    if (nodes > SOLVE_COUNT_NODE_BUDGET) return true;
    if (g.arrows.size === 0) {
      count++;
      return count >= cap;
    }
    const exits: Path[] = [];
    for (const p of g.arrows.values()) {
      if (slitherOutcome(g, p).kind === "exit") exits.push(p);
    }
    if (exits.length === 0) return false;
    for (const p of exits) {
      const cells = p.cells;
      const id = p.id;
      clearPath(g, id);
      const done = recurse();
      placePath(g, id, cells);
      if (done) return true;
    }
    return false;
  };
  recurse();
  return count;
}

export type SolveBucket = "unsolvable" | "unique" | "near-unique" | "many";

/**
 * Bucket the ordering multiplicity. `unique`=1, `near-unique`=2..cap-1,
 * `many`=cap or more, `unsolvable`=0. Wired to the DSL's `solverCheck`
 * field (default "solvable" accepts everything except unsolvable).
 */
export function solveBucket(
  cols: number,
  rows: number,
  paths: ReadonlyArray<Path>,
  cap: number = 8,
): SolveBucket {
  const n = solveCount(cols, rows, paths, cap);
  if (n === 0) return "unsolvable";
  if (n === 1) return "unique";
  if (n < cap) return "near-unique";
  return "many";
}

/**
 * Stable contract surface — `SolveTrace` is what the offline icon-to-level
 * pipeline's validator reads to decide whether a generated level has a
 * forced-prefix feel. The tool CLI at `games/arrow/content/level-tools/solver-check.mjs`
 * imports only `solveTrace` (and its types); callers must not reach into
 * the greedy internals of `solveInPlace`.
 *
 * Breaking changes here require a coordinated catalogue regeneration —
 * see `docs/decisions/2026-04-20-solver-contract-surface.md`.
 *
 * Discriminated union to prevent bang-assertions at call sites: callers
 * must branch on `kind` before reading branching metrics.
 */
export type SolveTrace =
  | {
      readonly kind: "solved";
      readonly path: ReadonlyArray<Coord>;
      /** Mean legal exit-arrows per step, averaged over the greedy solution. */
      readonly meanBranchingFactor: number;
      /** Max legal exit-arrows at any single step along the solution. */
      readonly maxBranchingFactor: number;
      /** Arrows blocked (slitherOutcome ≠ exit) at the initial state. */
      readonly blockedAtStart: number;
    }
  | {
      readonly kind: "unsolvable";
      readonly blockedAtStart: number;
    };

/**
 * Trace the greedy solution and measure branching factor per step in a
 * single pass. Uses `solveInPlace`'s iteration pattern but counts
 * `slitherOutcome(...).kind === "exit"` arrows at each state before
 * popping, rather than accepting the first exit found.
 *
 * "Legal tap" = an arrow that would change state if fired. By design,
 * firing an arrow whose slitherOutcome is "exit" removes it from the
 * grid; slitherOutcome already filters out blocked arrows. No secondary
 * "state-changing" check is needed — the definitions coincide.
 */
export function solveTrace(
  cols: number,
  rows: number,
  paths: ReadonlyArray<Path>,
): SolveTrace {
  const g = makePathGrid(cols, rows);
  for (const p of paths) placePath(g, p.id, p.cells);

  const initialCount = g.arrows.size;
  let blockedAtStart = 0;
  for (const p of g.arrows.values()) {
    if (slitherOutcome(g, p).kind !== "exit") blockedAtStart++;
  }

  const solutionPath: Coord[] = [];
  const legalCounts: number[] = [];

  for (let step = 0; step < initialCount; step++) {
    let legalCount = 0;
    let firstExit: Path | null = null;
    for (const p of g.arrows.values()) {
      if (slitherOutcome(g, p).kind === "exit") {
        legalCount++;
        if (firstExit === null) firstExit = p;
      }
    }
    if (firstExit === null) {
      return { kind: "unsolvable", blockedAtStart };
    }
    legalCounts.push(legalCount);
    solutionPath.push(headCell(firstExit));
    clearPath(g, firstExit.id);
  }

  const sum = legalCounts.reduce((a, b) => a + b, 0);
  const meanBranchingFactor = legalCounts.length === 0
    ? 0
    : sum / legalCounts.length;
  const maxBranchingFactor = legalCounts.length === 0
    ? 0
    : Math.max(...legalCounts);

  return {
    kind: "solved",
    path: solutionPath,
    meanBranchingFactor,
    maxBranchingFactor,
    blockedAtStart,
  };
}
