/**
 * Deterministic polyline-path generator.
 *
 * Given grid size, arrow count, and length/bend options, generate a
 * set of non-overlapping 4-connected paths. Each path is a valid
 * input to `placePath`.
 *
 * Algorithm per docs/polyline-rewrite-guide.md §5:
 *   - Xorshift32 PRNG for determinism.
 *   - For each arrow 1..N:
 *     - Pick a random empty cell as the start.
 *     - Random walk: at each step pick a random empty 4-neighbor.
 *       Bias toward continuing in the current direction unless
 *       rng < bendProb.
 *     - Stop at maxLen, or at first dead-end once minLen is reached.
 *     - If the walk couldn't reach minLen, discard and retry that arrow
 *       from a fresh start (up to PATH_RETRY_BUDGET times). If the
 *       budget is exhausted, the whole level is rejected.
 *
 * Solvability is NOT guaranteed here — GEN-2's solver decides that.
 * Callers compose: generate + solve + (reject & reseed if unsolvable).
 */

import {
  type Coord,
  type Path,
  type PathDir,
  type PathGrid,
  PATH_DIR_VEC,
  cellOwner,
  makePathGrid,
  placePath,
} from "./path.js";

export interface GenOptions {
  readonly minLen: number;
  readonly maxLen: number;
  /** Probability of turning at each step; 1-bendProb keeps going straight. */
  readonly bendProb: number;
  /** Optional target-length distribution. When present, each walk picks
   *  a length from this histogram (weighted random) instead of always
   *  running to maxLen. lenDist[i] is the weight for length minLen+i.
   *  Use to concentrate recipes toward a specific length mix (Pack 3
   *  Snakes wants mostly 5-8; Pack 8 Sparse wants a wide spread). */
  readonly lenDist?: ReadonlyArray<number>;
}

export interface GenResult {
  readonly paths: Path[];
  readonly grid: PathGrid;
}

/** Per-arrow retry budget — if a walk fails this many times, bail. */
export const PATH_RETRY_BUDGET = 200;

const DIRS: readonly PathDir[] = ["N", "S", "E", "W"];

function xorshift32(seed: number): () => number {
  // fmix32 (Murmur3 finalizer) avalanche on the seed so that every
  // input — including 0 — maps to a distinct nonzero 32-bit state.
  // Without this, seed=0 would collide with any fallback constant,
  // and neighboring seeds produce nearly-identical streams.
  let s = seed | 0;
  // Murmur3 finalizer constants — math, not brand colors.
  s = Math.imul(s ^ (s >>> 16), /* hex-allow: murmur */ 0x85ebca6b);
  s = Math.imul(s ^ (s >>> 13), /* hex-allow: murmur */ 0xc2b2ae35);
  s = s ^ (s >>> 16);
  if (s === 0) s = 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / /* hex-allow: 2^32 */ 0x100000000;
  };
}

function pick<T>(rnd: () => number, xs: readonly T[]): T | null {
  if (xs.length === 0) return null;
  return xs[Math.floor(rnd() * xs.length)]!;
}

function neighborsFrom(
  g: PathGrid,
  from: Coord,
  walked: Set<number>,
): Array<{ dir: PathDir; cell: Coord }> {
  const out: Array<{ dir: PathDir; cell: Coord }> = [];
  for (const d of DIRS) {
    const { dx, dy } = PATH_DIR_VEC[d];
    const nx = from.x + dx;
    const ny = from.y + dy;
    if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
    if (cellOwner(g, nx, ny) !== null) continue;
    const key = ny * g.cols + nx;
    if (walked.has(key)) continue;
    out.push({ dir: d, cell: { x: nx, y: ny } });
  }
  return out;
}

function randomStart(
  g: PathGrid,
  rnd: () => number,
): Coord | null {
  const candidates: Coord[] = [];
  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) {
      if (cellOwner(g, x, y) === null) candidates.push({ x, y });
    }
  }
  return pick(rnd, candidates);
}

/**
 * Walk a single path. Returns null if the walk couldn't reach minLen
 * (e.g., boxed in by other arrows). Does NOT mutate `g`.
 */
function pickLenFromDist(
  rnd: () => number,
  lenDist: ReadonlyArray<number>,
  minLen: number,
): number {
  const total = lenDist.reduce((s, w) => s + w, 0);
  if (total <= 0) return minLen;
  let roll = rnd() * total;
  for (let i = 0; i < lenDist.length; i++) {
    roll -= lenDist[i]!;
    if (roll <= 0) return minLen + i;
  }
  return minLen + lenDist.length - 1;
}

export function samplePath(
  g: PathGrid,
  rnd: () => number,
  opts: GenOptions,
): Coord[] | null {
  const start = randomStart(g, rnd);
  if (!start) return null;

  const cells: Coord[] = [start];
  const walked = new Set<number>([start.y * g.cols + start.x]);
  let currentDir: PathDir | null = null;
  // When lenDist is present, pick a target length per-walk from the
  // histogram instead of always running to maxLen. Still capped by
  // maxLen so the upper bound is a real ceiling.
  const targetLen = opts.lenDist
    ? Math.min(opts.maxLen, pickLenFromDist(rnd, opts.lenDist, opts.minLen))
    : opts.maxLen;

  while (cells.length < targetLen) {
    const last = cells[cells.length - 1]!;
    const candidates = neighborsFrom(g, last, walked);
    if (candidates.length === 0) {
      // Dead-end. Accept if we met the minimum, else reject.
      return cells.length >= opts.minLen ? cells : null;
    }

    let chosen: { dir: PathDir; cell: Coord };
    if (currentDir !== null && rnd() >= opts.bendProb) {
      // Prefer continuing straight if that neighbor is available.
      const straight = candidates.find((c) => c.dir === currentDir);
      chosen = straight ?? pick(rnd, candidates)!;
    } else {
      chosen = pick(rnd, candidates)!;
    }

    cells.push(chosen.cell);
    walked.add(chosen.cell.y * g.cols + chosen.cell.x);
    currentDir = chosen.dir;
  }

  return cells;
}

/**
 * Generate `arrowCount` disjoint paths on a fresh `cols`×`rows` grid.
 * Throws if any arrow can't be placed within PATH_RETRY_BUDGET attempts.
 */
export function generatePaths(
  cols: number,
  rows: number,
  arrowCount: number,
  opts: GenOptions,
  seed: number,
): GenResult {
  if (opts.minLen < 2) {
    throw new Error(`generatePaths: minLen must be >= 2 (got ${opts.minLen})`);
  }
  if (opts.maxLen < opts.minLen) {
    throw new Error(
      `generatePaths: maxLen (${opts.maxLen}) < minLen (${opts.minLen})`,
    );
  }
  const rnd = xorshift32(seed);
  const grid = makePathGrid(cols, rows);
  const paths: Path[] = [];

  for (let id = 1; id <= arrowCount; id++) {
    let placed: Path | null = null;
    for (let attempt = 0; attempt < PATH_RETRY_BUDGET; attempt++) {
      const cells = samplePath(grid, rnd, opts);
      if (cells) {
        placed = placePath(grid, id, cells);
        break;
      }
    }
    if (!placed) {
      throw new Error(
        `generatePaths: failed to place arrow ${id} of ${arrowCount} on ${cols}x${rows} (seed=${seed}, opts=${JSON.stringify(opts)})`,
      );
    }
    paths.push(placed);
  }

  return { paths, grid };
}
