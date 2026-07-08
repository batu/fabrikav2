import { describe, expect, it } from "vitest";

import { type Path } from "../../src/game/path.js";
import { generatePaths } from "../../src/game/path-generator.js";
import { blockedAtTurn1, solve, solveBucket, solveCount, validateLevel } from "../../src/game/solver.js";

describe("solve — basic cases", () => {
  it("returns a single tap for one arrow with a clear exit", () => {
    const arrow: Path = {
      id: 1,
      cells: [
        { x: 2, y: 2 },
        { x: 2, y: 1 },
      ],
    };
    const order = solve(5, 5, [arrow]);
    expect(order).not.toBeNull();
    expect(order).toEqual([{ x: 2, y: 1 }]);
  });

  it("returns tap order clearing two disjoint arrows with clear exits", () => {
    const a: Path = { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
    const b: Path = { id: 2, cells: [{ x: 0, y: 4 }, { x: 0, y: 3 }] };
    const order = solve(5, 5, [a, b]);
    expect(order).not.toBeNull();
    expect(order!.length).toBe(2);
  });

  it("finds the correct order when the front arrow blocks the back one", () => {
    // A: tail (0,0) → head (1,0), head-dir = E. Ray east: (2,0), (3,0), (4,0).
    // B: tail (4,0) → head (3,0), head-dir = W. Ray west: (2,0), (1,0)-own-A-head, ...
    // Hmm — placing both means they point at each other and neither can exit
    // at T1. Use a different setup: A points north (clear), B is behind it
    // blocked by A until A leaves.
    //   A at (2,1) → (2,0), head-dir N, exits immediately.
    //   B at (2,3) → (2,2), head-dir N, blocked by A's body at (2,1).
    //   After A clears, B has a clear ray north.
    const a: Path = { id: 1, cells: [{ x: 2, y: 1 }, { x: 2, y: 0 }] };
    const b: Path = { id: 2, cells: [{ x: 2, y: 3 }, { x: 2, y: 2 }] };
    const order = solve(5, 5, [a, b]);
    expect(order).not.toBeNull();
    expect(order).toEqual([
      { x: 2, y: 0 }, // A first
      { x: 2, y: 2 }, // then B
    ]);
  });
});

describe("solve — unsolvable cases", () => {
  it("returns null for two arrows pointing at each other", () => {
    const a: Path = { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
    const b: Path = { id: 2, cells: [{ x: 4, y: 0 }, { x: 3, y: 0 }] };
    const order = solve(5, 1, [a, b]);
    expect(order).toBeNull();
  });

  it("returns null when greedy stalls after the only exit is popped", () => {
    // 3-arrow layout on a 5×2 grid:
    //   A: (2,1) → (2,0), head (2,0), dir N. Clean exit off the top.
    //   B: (0,0) → (1,0), head (1,0), dir E. Ray east hits A at (2,0)
    //     (while A is placed); once A pops, (2,0) is empty, (3,0)
    //     empty, (4,0) is C. B blocked by C.
    //   C: (4,0) → (3,0), head (3,0), dir W. Ray west hits A at
    //     (2,0); once A pops, ray hits B at (1,0). C blocked by B.
    // After greedy pops A, B and C are mutually blocking. null.
    const a: Path = { id: 1, cells: [{ x: 2, y: 1 }, { x: 2, y: 0 }] };
    const b: Path = { id: 2, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
    const c: Path = { id: 3, cells: [{ x: 4, y: 0 }, { x: 3, y: 0 }] };
    expect(solve(5, 2, [a, b, c])).toBeNull();
  });

  it("returns [] for empty input", () => {
    expect(solve(5, 5, [])).toEqual([]);
  });
});

describe("validateLevel", () => {
  it("is true for a solvable layout", () => {
    const a: Path = { id: 1, cells: [{ x: 2, y: 1 }, { x: 2, y: 0 }] };
    expect(validateLevel(3, 3, [a])).toBe(true);
  });

  it("is false for a mutually blocked layout", () => {
    const a: Path = { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
    const b: Path = { id: 2, cells: [{ x: 4, y: 0 }, { x: 3, y: 0 }] };
    expect(validateLevel(5, 1, [a, b])).toBe(false);
  });
});

describe("solver + generator integration", () => {
  it("pins solvability count for seeds 1..20 on 6x8 with 3 arrows", () => {
    // Deterministic seed sweep — exact count locked in so that a
    // regression lowering solvability is caught immediately. GEN-3
    // will re-tune this for the actual difficulty curve.
    let solvable = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { paths } = generatePaths(
        6,
        8,
        3,
        { minLen: 2, maxLen: 4, bendProb: 0.3 },
        seed,
      );
      if (validateLevel(6, 8, paths)) solvable++;
    }
    expect(solvable).toBe(17);
  });
});

describe("blockedAtTurn1", () => {
  it("is 0 when every arrow has a clear exit", () => {
    // A exits east from (1,0); B exits south from (4,3). Rays don't
    // intersect each other or cross either arrow's body.
    const a: Path = { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
    const b: Path = { id: 2, cells: [{ x: 4, y: 2 }, { x: 4, y: 3 }] };
    expect(blockedAtTurn1(5, 5, [a, b])).toBe(0);
  });

  it("counts arrows blocked by foreign bodies", () => {
    // A exits freely; B is blocked by A.
    const a: Path = { id: 1, cells: [{ x: 2, y: 1 }, { x: 2, y: 0 }] };
    const b: Path = { id: 2, cells: [{ x: 2, y: 3 }, { x: 2, y: 2 }] };
    expect(blockedAtTurn1(5, 5, [a, b])).toBe(1);
  });

  it("counts both arrows blocked in a mutual-point layout", () => {
    const a: Path = { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
    const b: Path = { id: 2, cells: [{ x: 4, y: 0 }, { x: 3, y: 0 }] };
    expect(blockedAtTurn1(5, 1, [a, b])).toBe(2);
  });
});

describe("solveCount + solveBucket", () => {
  it("returns 0 for unsolvable layouts", () => {
    // Two arrows pointing at each other — neither can exit.
    const a: Path = { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
    const b: Path = { id: 2, cells: [{ x: 4, y: 0 }, { x: 3, y: 0 }] };
    expect(solveCount(5, 1, [a, b])).toBe(0);
    expect(solveBucket(5, 1, [a, b])).toBe("unsolvable");
  });

  it("returns 1 for a forced-order chain", () => {
    // A must leave before B — only one ordering clears.
    const a: Path = { id: 1, cells: [{ x: 2, y: 1 }, { x: 2, y: 0 }] };
    const b: Path = { id: 2, cells: [{ x: 2, y: 3 }, { x: 2, y: 2 }] };
    expect(solveCount(5, 5, [a, b])).toBe(1);
    expect(solveBucket(5, 5, [a, b])).toBe("unique");
  });

  it("returns 2 for two mutually-free arrows (either order works)", () => {
    // A: head (0,1) dir S → ray goes S, misses B entirely.
    // B: head (5,1) dir S → ray goes S, misses A entirely.
    const a: Path = { id: 1, cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }] };
    const b: Path = { id: 2, cells: [{ x: 5, y: 0 }, { x: 5, y: 1 }] };
    expect(solveCount(6, 6, [a, b])).toBe(2);
    expect(solveBucket(6, 6, [a, b])).toBe("near-unique");
  });

  it("respects the cap — stops counting once cap is reached", () => {
    // Three mutually-exit-free arrows → 3! = 6 orderings; cap at 3 reports 3.
    // Separated so no arrow's ray touches another's body.
    const a: Path = { id: 1, cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }] }; // head (0,1) dir S
    const b: Path = { id: 2, cells: [{ x: 5, y: 0 }, { x: 5, y: 1 }] }; // head (5,1) dir S
    const c: Path = { id: 3, cells: [{ x: 2, y: 5 }, { x: 3, y: 5 }] }; // head (3,5) dir E
    expect(solveCount(6, 6, [a, b, c], 3)).toBe(3);
    expect(solveBucket(6, 6, [a, b, c], 3)).toBe("many");
  });

  it("buckets three mutually-free arrows at default cap=8 as near-unique", () => {
    // 3! = 6 orderings; 6 < 8 → near-unique.
    const a: Path = { id: 1, cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }] };
    const b: Path = { id: 2, cells: [{ x: 5, y: 0 }, { x: 5, y: 1 }] };
    const c: Path = { id: 3, cells: [{ x: 2, y: 5 }, { x: 3, y: 5 }] };
    expect(solveCount(6, 6, [a, b, c])).toBe(6);
    expect(solveBucket(6, 6, [a, b, c])).toBe("near-unique");
  });
});
