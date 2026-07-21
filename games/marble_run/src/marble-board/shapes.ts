/**
 * Mirror-symmetric board-shape library for the Marble Run engine.
 *
 * Emits board masks only — '.' playable dimple, '#' void, 'X' plug (see
 * types.ts). No marble chars: the generator fills those. Every kind is a
 * predicate written in terms of the mirrored distances `dx`/`dy` rather
 * than raw coordinates, so left-right symmetry (and top-bottom symmetry,
 * where the predicate ignores the sign of y) falls out by construction
 * instead of being hand-drawn.
 */
import { gateMouthCell, type Side } from './types';

export type ShapeKind =
  | 'plain'
  | 'corners'
  | 'diamond'
  | 'ring'
  | 'cross'
  | 'hourglass'
  | 'frame-notch'
  | 'butterfly'
  | 'twin-holes'
  | 'pillars'
  | 'checker-plugs'
  | 'arena';

export const ALL_SHAPE_KINDS: readonly ShapeKind[] = [
  'plain',
  'corners',
  'diamond',
  'ring',
  'cross',
  'hourglass',
  'frame-notch',
  'butterfly',
  'twin-holes',
  'pillars',
  'checker-plugs',
  'arena',
];

/** The most visually striking kinds — for spike/climax levels. */
export const landmarkShapes: readonly ShapeKind[] = [
  'diamond',
  'ring',
  'cross',
  'hourglass',
  'butterfly',
  'arena',
];

/** Boards smaller than this in either axis are never sculpted. */
const MIN_SCULPT_SIZE = 6;

/**
 * Half-open distance from the nearer edge: 0 on the border, growing
 * inward, and identical for a coordinate and its mirror.
 */
function edgeDistance(v: number, extent: number): number {
  return Math.min(v, extent - 1 - v);
}

/** Doubled distance from the axis centre — integer, and mirror-equal. */
function centreDistance(v: number, extent: number): number {
  return Math.abs(2 * v - (extent - 1));
}

interface Geometry {
  readonly cols: number;
  readonly rows: number;
  readonly dx: number;
  readonly dy: number;
  readonly x: number;
  readonly y: number;
}

type CellPredicate = (g: Geometry) => string;

function cornerCut(cols: number, rows: number): number {
  return Math.max(1, Math.floor(Math.min(cols, rows) / 4));
}

/** Inner margin of the ring/arena wall — the hole starts at this depth. */
function ringMargin(cols: number, rows: number): number {
  return Math.max(2, Math.floor(Math.min(cols, rows) / 4));
}

/**
 * Widest inward bite a side taper may take while still leaving at least
 * two playable columns at the waist.
 */
function maxTaper(cols: number): number {
  return Math.max(0, Math.floor(cols / 2) - 2);
}

const PREDICATES: Readonly<Record<ShapeKind, CellPredicate>> = {
  plain: () => '.',

  corners: ({ dx, dy, cols, rows }) => (dx + dy < cornerCut(cols, rows) ? '#' : '.'),

  diamond: ({ dx, dy, cols, rows }) =>
    dx + dy < Math.max(1, Math.floor(Math.min(cols, rows) / 2) - 1) ? '#' : '.',

  ring: ({ dx, dy, cols, rows }) => {
    const m = ringMargin(cols, rows);
    return dx >= m && dy >= m ? '#' : '.';
  },

  // A plus: keep the central column band and the central row band.
  cross: ({ x, y, cols, rows }) => {
    const inBandX = centreDistance(x, cols) <= cols / 3;
    const inBandY = centreDistance(y, rows) <= rows / 3;
    return inBandX || inBandY ? '.' : '#';
  },

  // Widest at top and bottom, pinched at the waist.
  hourglass: ({ dx, dy, cols }) => (dx < Math.min(maxTaper(cols), dy) ? '#' : '.'),

  // Full board with a shallow bite out of the centre of each side.
  'frame-notch': ({ x, y, dx, dy, cols, rows }) => {
    const depth = Math.max(1, Math.round(Math.min(cols, rows) / 5));
    const notchTopBottom = dy < depth && centreDistance(x, cols) <= 1;
    const notchLeftRight = dx < depth && centreDistance(y, rows) <= 1;
    return notchTopBottom || notchLeftRight ? '#' : '.';
  },

  // Wings: a wedge bitten out of both sides, widest at the top, plus a
  // short plug "body" down the centre of the upper half.
  butterfly: ({ x, y, dx, cols, rows }) => {
    const wedge = Math.floor(((rows - 1 - y) * maxTaper(cols)) / (rows - 1));
    if (dx < wedge) return '#';
    const bodyWidth = cols % 2 === 0 ? 1 : 0;
    const inBody = y >= 1 && y < Math.floor(rows / 2) && centreDistance(x, cols) <= bodyWidth;
    return inBody ? 'X' : '.';
  },

  // Two mirrored voids straddling the vertical midline.
  'twin-holes': ({ dx, dy, cols, rows }) => {
    const holeX = Math.max(1, Math.floor(cols / 4));
    const midDy = Math.max(1, Math.floor((rows - 1) / 2) - 1);
    return dx === holeX && dy >= midDy ? '#' : '.';
  },

  // Plug lattice on odd edge-distances — never on the border.
  pillars: ({ dx, dy }) => (dx >= 1 && dy >= 1 && dx % 2 === 1 && dy % 2 === 1 ? 'X' : '.'),

  // Plug lattice staggered off `pillars`, on even edge-distances.
  'checker-plugs': ({ dx, dy }) => (dx >= 2 && dy >= 2 && dx % 2 === 0 && dy % 2 === 0 ? 'X' : '.'),

  // Ring with its corners rounded off.
  arena: ({ dx, dy, cols, rows }) => {
    const m = ringMargin(cols, rows);
    const cut = Math.max(1, Math.floor(Math.min(cols, rows) / 5));
    if (dx + dy < cut) return '#';
    return dx >= m && dy >= m ? '#' : '.';
  },
};

/**
 * Build the `cells` mask for a board of `cols` x `rows`. Boards smaller
 * than 6 in either axis fall back to `plain` for every kind — sculpting
 * a tiny board eats the playable region.
 */
export function buildShape(kind: ShapeKind, cols: number, rows: number): string[] {
  // Fail fast: a fractional size silently yields an asymmetric mask, and an
  // unknown kind (JS caller) would crash only on boards >= 6 — surface both
  // immediately, size-independently.
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new Error(`buildShape: invalid size ${cols}x${rows}`);
  }
  if (PREDICATES[kind] === undefined) {
    throw new Error(`buildShape: unknown kind ${String(kind)}`);
  }
  const effective: ShapeKind =
    cols < MIN_SCULPT_SIZE || rows < MIN_SCULPT_SIZE ? 'plain' : kind;
  const predicate = PREDICATES[effective];

  const out: string[] = [];
  for (let y = 0; y < rows; y += 1) {
    let row = '';
    for (let x = 0; x < cols; x += 1) {
      row += predicate({
        cols,
        rows,
        x,
        y,
        dx: edgeDistance(x, cols),
        dy: edgeDistance(y, rows),
      });
    }
    out.push(row);
  }
  return out;
}

/**
 * Border positions on `side` whose gate mouth cell is playable. A gate
 * onto a void or a plug can never be reached, so those indices are
 * excluded.
 */
export function validGateIndices(shape: readonly string[], side: Side): number[] {
  const rows = shape.length;
  const cols = shape[0]!.length;
  const extent = side === 'top' || side === 'bottom' ? cols : rows;

  const indices: number[] = [];
  for (let index = 0; index < extent; index += 1) {
    const mouth = gateMouthCell({ side, index, color: 'red' }, cols, rows);
    if (shape[mouth.y]![mouth.x] === '.') indices.push(index);
  }
  return indices;
}
