/**
 * GameState + applyTap — the state machine for the polyline model.
 *
 * Invariants pinned:
 *   - status ∈ {'idle','playing','won','lost'}, monotonic within a level
 *   - lives decrement only on blocked taps, never on exits
 *   - last exit flips status to 'won'; drain-to-zero flips to 'lost'
 *   - applyTap returns null on empty cells or non-'playing' states
 *   - tap-anywhere-on-body activates the arrow (cellIndex lookup)
 */

import { describe, expect, it } from "vitest";

import {
  applyTap,
  arrowsRemaining,
  initialState,
  loadLevel,
  MAX_LIVES,
  type LevelSpec,
} from "../../src/game/state.js";
import { cellOwner, type Path } from "../../src/game/path.js";

function level(paths: Path[], cols = 5, rows = 5): LevelSpec {
  return { index: 1, cols, rows, paths };
}

describe("initialState", () => {
  it("starts idle with full lives and a 1x1 sentinel grid", () => {
    const s = initialState();
    expect(s.status).toBe("idle");
    expect(s.lives).toBe(MAX_LIVES);
    expect(s.level).toBe(0);
    expect(s.grid.cols).toBe(1);
    expect(s.grid.rows).toBe(1);
  });
});

describe("loadLevel", () => {
  it("resets lives, sets playing, installs paths at the spec positions", () => {
    const s = initialState();
    s.lives = 1;
    loadLevel(
      s,
      level([{ id: 1, cells: [{ x: 1, y: 2 }, { x: 1, y: 1 }] }]),
    );
    expect(s.status).toBe("playing");
    expect(s.lives).toBe(MAX_LIVES);
    expect(cellOwner(s.grid, 1, 2)).toBe(1);
    expect(cellOwner(s.grid, 1, 1)).toBe(1);
    expect(arrowsRemaining(s)).toBe(1);
  });

  it("replaces a prior level's paths on subsequent call", () => {
    const s = initialState();
    loadLevel(s, level([{ id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]));
    loadLevel(s, level([{ id: 1, cells: [{ x: 2, y: 3 }, { x: 2, y: 2 }] }]));
    expect(cellOwner(s.grid, 0, 0)).toBeNull();
    expect(cellOwner(s.grid, 2, 3)).toBe(1);
  });
});

describe("applyTap", () => {
  it("returns null when the cell is empty", () => {
    const s = initialState();
    loadLevel(s, level([{ id: 1, cells: [{ x: 1, y: 1 }, { x: 1, y: 0 }] }]));
    expect(applyTap(s, 0, 0)).toBeNull();
  });

  it("returns null when the game isn't 'playing'", () => {
    const s = initialState();
    loadLevel(s, level([{ id: 1, cells: [{ x: 1, y: 1 }, { x: 1, y: 0 }] }]));
    s.status = "lost";
    expect(applyTap(s, 1, 1)).toBeNull();
  });

  it("activates the arrow when tapped on its tail (tap-anywhere-on-body)", () => {
    const s = initialState();
    loadLevel(
      s,
      level([
        { id: 1, cells: [{ x: 2, y: 4 }, { x: 2, y: 3 }, { x: 2, y: 2 }, { x: 2, y: 1 }] },
      ]),
    );
    // Tap on the tail cell (y=4). Head-dir is N, ray clear → exit.
    const res = applyTap(s, 2, 4);
    expect(res).not.toBeNull();
    expect(res!.blocked).toBe(false);
    expect(res!.completed).toBe(true);
    expect(s.status).toBe("won");
  });

  it("activates the arrow when tapped on a mid-body cell", () => {
    const s = initialState();
    loadLevel(
      s,
      level([
        { id: 1, cells: [{ x: 2, y: 4 }, { x: 2, y: 3 }, { x: 2, y: 2 }, { x: 2, y: 1 }] },
      ]),
    );
    const res = applyTap(s, 2, 3);
    expect(res).not.toBeNull();
    expect(res!.blocked).toBe(false);
    expect(res!.completed).toBe(true);
  });

  it("removes the arrow and flips status to 'won' on the last exit", () => {
    const s = initialState();
    loadLevel(s, level([{ id: 1, cells: [{ x: 1, y: 2 }, { x: 1, y: 1 }] }]));
    const res = applyTap(s, 1, 1);
    expect(res!.blocked).toBe(false);
    expect(res!.completed).toBe(true);
    expect(s.status).toBe("won");
    expect(arrowsRemaining(s)).toBe(0);
  });

  it("on collide applyTap decrements lives but defers visual feedback (loop fires it at impact)", () => {
    const s = initialState();
    loadLevel(
      s,
      level([
        { id: 1, cells: [{ x: 1, y: 0 }, { x: 1, y: 1 }] },
        { id: 2, cells: [{ x: 1, y: 3 }, { x: 1, y: 2 }] },
      ]),
    );
    // Collide — tap arrow 1 (head S, blocked by arrow 2).
    const before = s.lives;
    const r1 = applyTap(s, 1, 1);
    expect(r1!.blocked).toBe(true);
    expect(s.lives).toBe(before - 1);
    // Visual feedback fields stay null — loop.ts sets them when the
    // anim's impactJustHappened fires (at head arrival, not tap).
    expect(s.collisionCell).toBeNull();
    expect(s.failingArrowId).toBeNull();
    expect(s.failingT).toBe(0);
  });

  it("leaves the path in place + decrements lives on a blocked tap", () => {
    const s = initialState();
    // A: (1,0)→(1,1), head-dir S, ray south hits B at (1,3).
    // B: (1,3)→(1,2), head-dir N.
    loadLevel(
      s,
      level([
        { id: 1, cells: [{ x: 1, y: 0 }, { x: 1, y: 1 }] },
        { id: 2, cells: [{ x: 1, y: 3 }, { x: 1, y: 2 }] },
      ]),
    );
    const before = s.lives;
    const res = applyTap(s, 1, 1);
    expect(res!.blocked).toBe(true);
    expect(res!.failed).toBe(false);
    expect(s.lives).toBe(before - 1);
    expect(cellOwner(s.grid, 1, 1)).toBe(1); // still there
    // collisionCell is now deferred to impact (loop wires it from
    // frame.impactJustHappened). applyTap alone leaves it null.
    expect(s.collisionCell).toBeNull();
  });

  it("flips to 'lost' when lives drain to zero on a blocked tap", () => {
    const s = initialState();
    loadLevel(
      s,
      level([
        { id: 1, cells: [{ x: 1, y: 0 }, { x: 1, y: 1 }] },
        { id: 2, cells: [{ x: 1, y: 3 }, { x: 1, y: 2 }] },
      ]),
    );
    s.lives = 1;
    const res = applyTap(s, 1, 1);
    expect(res!.blocked).toBe(true);
    expect(res!.failed).toBe(true);
    expect(s.status).toBe("lost");
    expect(s.lives).toBe(0);
  });

  it("returns headDir on exit even when head sits on the edge (empty pathAhead)", () => {
    const s = initialState();
    // Head at the south edge (y = rows-1) with head-dir S means the
    // head immediately exits — pathAhead will be empty. Callers still
    // need headDir for exit FX direction.
    loadLevel(s, {
      index: 1,
      cols: 5,
      rows: 5,
      paths: [{ id: 1, cells: [{ x: 2, y: 3 }, { x: 2, y: 4 }] }],
    });
    const res = applyTap(s, 2, 4);
    expect(res).not.toBeNull();
    expect(res!.blocked).toBe(false);
    expect(res!.pathAhead).toEqual([]);
    expect(res!.headDir).toBe("S");
  });

  it("returns headDir on exit for each of N/S/E/W", () => {
    const cases: Array<[import("../../src/game/path.js").Path, "N" | "S" | "E" | "W"]> = [
      [{ id: 1, cells: [{ x: 2, y: 4 }, { x: 2, y: 3 }] }, "N"],
      [{ id: 1, cells: [{ x: 2, y: 0 }, { x: 2, y: 1 }] }, "S"],
      [{ id: 1, cells: [{ x: 0, y: 2 }, { x: 1, y: 2 }] }, "E"],
      [{ id: 1, cells: [{ x: 4, y: 2 }, { x: 3, y: 2 }] }, "W"],
    ];
    for (const [path, expectedDir] of cases) {
      const s = initialState();
      loadLevel(s, { index: 1, cols: 5, rows: 5, paths: [path] });
      const head = path.cells[path.cells.length - 1]!;
      const res = applyTap(s, head.x, head.y);
      expect(res!.headDir).toBe(expectedDir);
    }
  });

  it("does not flip to 'won' if one or more arrows remain after a successful tap", () => {
    const s = initialState();
    loadLevel(
      s,
      level([
        { id: 1, cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }] }, // head S, exits bottom
        { id: 2, cells: [{ x: 2, y: 2 }, { x: 3, y: 2 }] }, // head E, exits right
      ]),
    );
    const res = applyTap(s, 0, 1);
    expect(res!.blocked).toBe(false);
    expect(res!.completed).toBe(false);
    expect(s.status).toBe("playing");
    expect(arrowsRemaining(s)).toBe(1);
  });
});
