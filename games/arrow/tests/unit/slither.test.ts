import { describe, expect, it } from "vitest";

import { makePathGrid, placePath } from "../../src/game/path.js";
import { canExit, slitherOutcome } from "../../src/game/slither.js";

describe("slitherOutcome — straight paths", () => {
  it("exits when the head ray is clear to the edge", () => {
    const g = makePathGrid(5, 5);
    //  column 2: tail (2,4) → head (2,2), head-dir = N
    const a = placePath(g, 1, [
      { x: 2, y: 4 },
      { x: 2, y: 3 },
      { x: 2, y: 2 },
    ]);
    const r = slitherOutcome(g, a);
    expect(r.kind).toBe("exit");
    if (r.kind === "exit") {
      // pathAhead: (2,1), (2,0) — two cells walked before off-board.
      expect(r.pathAhead).toEqual([
        { x: 2, y: 1 },
        { x: 2, y: 0 },
      ]);
    }
  });

  it("exits immediately when the head is already on the edge", () => {
    const g = makePathGrid(5, 5);
    const a = placePath(g, 1, [
      { x: 2, y: 1 },
      { x: 2, y: 0 },
    ]);
    const r = slitherOutcome(g, a);
    expect(r.kind).toBe("exit");
    if (r.kind === "exit") {
      expect(r.pathAhead).toEqual([]);
    }
  });

  it("collides at the first foreign body cell on the head ray", () => {
    const g = makePathGrid(5, 5);
    // arrow A: tail (0,2) → head (1,2), head-dir = E
    const a = placePath(g, 1, [
      { x: 0, y: 2 },
      { x: 1, y: 2 },
    ]);
    // arrow B sits at column 3 row 2 — blocks A.
    placePath(g, 2, [
      { x: 3, y: 2 },
      { x: 3, y: 1 },
    ]);
    const r = slitherOutcome(g, a);
    expect(r.kind).toBe("collide");
    if (r.kind === "collide") {
      expect(r.cell).toEqual({ x: 3, y: 2 });
      expect(r.blockerId).toBe(2);
      // pathAhead includes (2,2) free then (3,2) collision.
      expect(r.pathAhead).toEqual([
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ]);
    }
  });

  it("collides at the nearest blocker when several are lined up", () => {
    const g = makePathGrid(6, 1);
    const a = placePath(g, 1, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    placePath(g, 2, [
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
    const r = slitherOutcome(g, a);
    expect(r.kind).toBe("collide");
    if (r.kind === "collide") {
      expect(r.cell).toEqual({ x: 3, y: 0 });
      expect(r.blockerId).toBe(2);
    }
  });
});

describe("slitherOutcome — L-shaped arrows", () => {
  it("exits when the L's head segment points off-board with a clear lane", () => {
    const g = makePathGrid(5, 5);
    // L: (0,0) → (0,1) → (0,2) → (1,2) → (2,2) ; head-dir = E
    const a = placePath(g, 1, [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    const r = slitherOutcome(g, a);
    expect(r.kind).toBe("exit");
    if (r.kind === "exit") {
      expect(r.pathAhead).toEqual([
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ]);
    }
  });

  it("collides two cells past the head when a foreign body sits in the lane", () => {
    const g = makePathGrid(5, 5);
    // A (L-shape, head-dir=E): (0,0)→(0,1)→(0,2)→(1,2)→(2,2)
    const a = placePath(g, 1, [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    // B sits at (4,2) — two cells past the head.
    placePath(g, 2, [
      { x: 4, y: 2 },
      { x: 4, y: 1 },
    ]);
    const r = slitherOutcome(g, a);
    expect(r.kind).toBe("collide");
    if (r.kind === "collide") {
      expect(r.cell).toEqual({ x: 4, y: 2 });
      expect(r.blockerId).toBe(2);
      expect(r.pathAhead).toEqual([
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ]);
    }
  });
});

describe("slitherOutcome — own-body collision (adversarial paths)", () => {
  it("collides on own body when the head ray re-enters the path", () => {
    const g = makePathGrid(5, 5);
    // Adversarial U-shape whose head points back into its own tail
    // segment. Construction: cells walk S, S, E, then the last step
    // is N — making head-dir = N and putting own-body cells (2,1) and
    // the tail (1,0) directly north of the head.
    //   (1,0) (2,0) (2,1) (2,2) (2,3) — head-dir of this straight
    //   path is S, not what we want. Need a real U:
    // Path: (0,0) → (0,1) → (0,2) → (1,2) → (1,1) — head-dir = N,
    //   head (1,1). North of head: (1,0) which is empty (not on path).
    //   Not re-entering. Need the head to point at an own cell.
    // Valid adversarial construction: (0,2) → (0,1) → (0,0) → (1,0) →
    //   (1,1) — head at (1,1), head-dir = S, directly south is (1,2)
    //   which is off the path — still no re-enter.
    // Use a tight U:
    //   (2,0) → (2,1) → (1,1) → (1,0)
    //   head (1,0), head-dir = N, head goes off-board — no collision.
    // Real adversarial: start far, sweep U, aim back at body:
    //   (0,0) → (1,0) → (2,0) → (2,1) → (2,2) → (1,2) → (1,1) → (0,1)
    //   head (0,1), head-dir = W, off-board after one step. no.
    // Curl:
    //   (0,2) → (1,2) → (2,2) → (2,1) → (2,0) → (1,0) → (0,0) → (0,1)
    //   head (0,1), head-dir = S, south = (0,2) which IS on the path.
    const a = placePath(g, 1, [
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 1 },
      { x: 2, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ]);
    const r = slitherOutcome(g, a);
    expect(r.kind).toBe("collide");
    if (r.kind === "collide") {
      expect(r.cell).toEqual({ x: 0, y: 2 });
      expect(r.blockerId).toBe(1); // own id
      expect(r.pathAhead).toEqual([{ x: 0, y: 2 }]);
    }
  });
});

describe("slitherOutcome — preconditions", () => {
  it("throws if the arrow is not placed on the grid", () => {
    const g = makePathGrid(3, 3);
    const stray = {
      id: 99,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    };
    expect(() => slitherOutcome(g, stray)).toThrow(/not placed on the grid/);
  });

  it("propagates the headDir throw for a non-4-connected last step", () => {
    const g = makePathGrid(3, 3);
    // Place a valid arrow so the arrows.has check passes, then hand
    // slitherOutcome a lookalike path whose last step is diagonal.
    placePath(g, 1, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    const malformed = {
      id: 1,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    expect(() => slitherOutcome(g, malformed)).toThrow(/not 4-connected/);
  });
});

describe("slitherOutcome — own-body collision with intermediate empty cells", () => {
  it("walks past empty cells in pathAhead before hitting own body", () => {
    const g = makePathGrid(6, 3);
    // Curl with head facing W and empty cells between head and tail:
    //   (0,0) → (0,1) → (0,2) → (1,2) → (2,2) → (3,2) → (4,2) →
    //   (5,2) → (5,1) → (5,0) → (4,0) → (3,0)
    //   head = (3,0), head-dir = W. West ray: (2,0) empty, (1,0)
    //   empty, (0,0) own-body (tail).
    const a = placePath(g, 1, [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
      { x: 5, y: 1 },
      { x: 5, y: 0 },
      { x: 4, y: 0 },
      { x: 3, y: 0 },
    ]);
    const r = slitherOutcome(g, a);
    expect(r.kind).toBe("collide");
    if (r.kind === "collide") {
      expect(r.cell).toEqual({ x: 0, y: 0 });
      expect(r.blockerId).toBe(1);
      expect(r.pathAhead).toEqual([
        { x: 2, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 0 },
      ]);
    }
  });
});

describe("canExit helper", () => {
  it("is true when the head ray is clear", () => {
    const g = makePathGrid(3, 3);
    const a = placePath(g, 1, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(canExit(g, a)).toBe(true);
  });

  it("is false when a foreign body blocks", () => {
    const g = makePathGrid(5, 1);
    const a = placePath(g, 1, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    placePath(g, 2, [
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(canExit(g, a)).toBe(false);
  });
});
