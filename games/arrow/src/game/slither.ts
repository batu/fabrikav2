/**
 * Slither outcome — the semantic result of tapping an arrow.
 *
 * Why a ray-cast is equivalent to a snake simulation: during slither
 * the head moves only in its constant head-direction (it never turns
 * mid-slither). The head is the only agent that can enter a new cell,
 * so whether the head collides is fully determined by whatever sits
 * on the ray extended from the head along head-dir. Walking that ray
 * is O(max(cols, rows)) — cheap and uniform.
 *
 * Own-body + foreign-body are both treated as "occupied". For
 * generator-produced paths, the head ray never re-enters own body
 * because the last step of the path moves away from the prior segment
 * and the path is non-self-intersecting. For adversarial hand-built
 * paths, the uniform check defends against bad data.
 *
 * `pathAhead` is the ordered list of cells the head crosses from
 * head+1 onward, up to and including the collision cell (or the last
 * in-bounds cell walked before an exit). MECH-4's animation consumes
 * this directly.
 */

import {
  PATH_DIR_VEC,
  headCell,
  headDir,
  idx,
  inBounds,
  type Coord,
  type Path,
  type PathGrid,
} from "./path.js";

export type SlitherOutcome =
  | { readonly kind: "exit"; readonly pathAhead: ReadonlyArray<Coord> }
  | {
      readonly kind: "collide";
      readonly cell: Coord;
      readonly blockerId: number;
      readonly pathAhead: ReadonlyArray<Coord>;
    };

/**
 * Scan from the arrow's head along head-dir. First out-of-bounds
 * step yields `exit`. First in-bounds cell with any owner yields
 * `collide` (the owner's id is returned, which may equal the
 * scanned arrow's own id if the path is adversarial).
 *
 * Precondition: the arrow must still be placed on `g` when this
 * runs — the scan does not skip own cells, so a caller that cleared
 * the arrow first would get a silent wrong answer. Enforced by a
 * fast-fail `arrows.has(id)` check.
 */
export function slitherOutcome(g: PathGrid, p: Path): SlitherOutcome {
  if (!g.arrows.has(p.id)) {
    throw new Error(
      `slitherOutcome: arrow ${p.id} is not placed on the grid`,
    );
  }
  const head = headCell(p);
  const { dx, dy } = PATH_DIR_VEC[headDir(p)];

  const pathAhead: Coord[] = [];
  let x = head.x + dx;
  let y = head.y + dy;
  while (true) {
    if (!inBounds(g, x, y)) {
      return { kind: "exit", pathAhead };
    }
    const cell: Coord = { x, y };
    pathAhead.push(cell);
    const owner = g.cellIndex[idx(g, x, y)] ?? null;
    if (owner !== null) {
      return { kind: "collide", cell, blockerId: owner, pathAhead };
    }
    x += dx;
    y += dy;
  }
}

/** Convenience: does this arrow have a clean exit right now? */
export function canExit(g: PathGrid, p: Path): boolean {
  return slitherOutcome(g, p).kind === "exit";
}
