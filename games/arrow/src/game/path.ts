/**
 * Polyline-arrow model: an arrow is an ordered path of 4-connected cells from
 * tail to head. Every cell on that path is part of the arrow body, and tapping
 * any of them activates the arrow.
 *
 * This is the v1 shared path API inlined for the fabrikav2 port so the game
 * package is self-contained.
 */

export interface Coord {
  readonly x: number;
  readonly y: number;
}

export interface Path {
  readonly id: number;
  /** Ordered tail->head. Length >= 2; each step 4-connected; no duplicates. */
  readonly cells: ReadonlyArray<Coord>;
}

export interface PathGrid {
  readonly cols: number;
  readonly rows: number;
  /** Forward index: id -> path. */
  readonly arrows: Map<number, Path>;
  /**
   * Reverse index: row-major cell -> owning arrow id.
   * Length = cols * rows. Kept in sync with `arrows` by placePath/clearPath.
   */
  readonly cellIndex: (number | null)[];
}

export type PathDir = "N" | "S" | "E" | "W";

export interface DirVec {
  readonly dx: number;
  readonly dy: number;
}

export const PATH_DIR_VEC: Readonly<Record<PathDir, DirVec>> = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
};

export function makePathGrid(cols: number, rows: number): PathGrid {
  return {
    cols,
    rows,
    arrows: new Map(),
    cellIndex: new Array<number | null>(cols * rows).fill(null),
  };
}

export function idx(g: PathGrid, x: number, y: number): number {
  return y * g.cols + x;
}

export function inBounds(g: PathGrid, x: number, y: number): boolean {
  return x >= 0 && x < g.cols && y >= 0 && y < g.rows;
}

export function cellOwner(g: PathGrid, x: number, y: number): number | null {
  if (!inBounds(g, x, y)) return null;
  return g.cellIndex[idx(g, x, y)] ?? null;
}

/**
 * Unit direction from the second-to-last cell to the head.
 * Throws when a caller-constructed Path violates the placement invariant.
 */
export function headDir(p: Path): PathDir {
  const n = p.cells.length;
  if (n < 2) {
    throw new Error(`headDir: path ${p.id} has length ${n}, need >= 2`);
  }
  const a = p.cells[n - 2]!;
  const b = p.cells[n - 1]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === -1) return "N";
  if (dx === 0 && dy === 1) return "S";
  if (dx === 1 && dy === 0) return "E";
  if (dx === -1 && dy === 0) return "W";
  throw new Error(
    `headDir: last step is not 4-connected (dx=${dx}, dy=${dy}) for arrow ${p.id}`,
  );
}

export function headCell(p: Path): Coord {
  if (p.cells.length === 0) {
    throw new Error(`headCell: path ${p.id} is empty`);
  }
  return p.cells[p.cells.length - 1]!;
}

export function tailCell(p: Path): Coord {
  if (p.cells.length === 0) {
    throw new Error(`tailCell: path ${p.id} is empty`);
  }
  return p.cells[0]!;
}

/**
 * Place a path on the grid, claiming every cell in cellIndex.
 * Validates first so any thrown error leaves the grid unchanged.
 */
export function placePath(g: PathGrid, id: number, cells: ReadonlyArray<Coord>): Path {
  if (cells.length < 2) {
    throw new Error(`placePath: path must have length >= 2 (got ${cells.length})`);
  }
  if (g.arrows.has(id)) {
    throw new Error(`placePath: arrow id ${id} already placed`);
  }

  const seen = new Set<number>();
  for (let i = 0; i < cells.length; i += 1) {
    const c = cells[i]!;
    if (!inBounds(g, c.x, c.y)) {
      throw new Error(
        `placePath: cell (${c.x}, ${c.y}) out of bounds for ${g.cols}x${g.rows}`,
      );
    }
    const key = idx(g, c.x, c.y);
    if (seen.has(key)) {
      throw new Error(
        `placePath: path ${id} visits (${c.x}, ${c.y}) twice (self-intersecting)`,
      );
    }
    seen.add(key);
    if (g.cellIndex[key] !== null) {
      throw new Error(
        `placePath: cell (${c.x}, ${c.y}) already owned by arrow ${g.cellIndex[key]}`,
      );
    }
    if (i > 0) {
      const prev = cells[i - 1]!;
      const dx = Math.abs(c.x - prev.x);
      const dy = Math.abs(c.y - prev.y);
      if (dx + dy !== 1) {
        throw new Error(
          `placePath: step ${i - 1}->${i} not 4-connected (${prev.x},${prev.y})->(${c.x},${c.y})`,
        );
      }
    }
  }

  for (const c of cells) {
    g.cellIndex[idx(g, c.x, c.y)] = id;
  }
  const path: Path = { id, cells };
  g.arrows.set(id, path);
  return path;
}

/** Remove a path by id. No-op if id is unknown. */
export function clearPath(g: PathGrid, id: number): void {
  const path = g.arrows.get(id);
  if (!path) return;
  for (const c of path.cells) {
    const k = idx(g, c.x, c.y);
    if (g.cellIndex[k] === id) g.cellIndex[k] = null;
  }
  g.arrows.delete(id);
}

export function arrowCount(g: PathGrid): number {
  return g.arrows.size;
}
