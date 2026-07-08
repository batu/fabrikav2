import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Path } from "../../src/game/path.js";
import {
  solve,
  solveTrace,
  validateLevel,
} from "../../src/game/solver.js";

describe("solveTrace — basic outcomes", () => {
  it("reports unsolvable when greedy solve fails", () => {
    // Mutual-deadlock pair on a 4×1 row:
    //   A: tail (0,0) → head (1,0), direction E — slither E into (2,0) owned by B → collide
    //   B: tail (3,0) → head (2,0), direction W — slither W into (1,0) owned by A → collide
    const paths: Path[] = [
      { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
      { id: 2, cells: [{ x: 3, y: 0 }, { x: 2, y: 0 }] },
    ];
    expect(solve(4, 1, paths)).toBeNull();
    const trace = solveTrace(4, 1, paths);
    expect(trace.kind).toBe("unsolvable");
    if (trace.kind === "unsolvable") {
      expect(trace.blockedAtStart).toBe(2);
    }
  });

  it("handles zero-arrow input as trivially solved", () => {
    // Edge case: an empty level. Contract: kind='solved' with empty path
    // and zero branching-factor fields. Exercises the legalCounts.length===0
    // guards in solver.ts (meanBF and maxBF fall back to 0, not -Infinity/NaN).
    const trace = solveTrace(4, 4, []);
    expect(trace.kind).toBe("solved");
    if (trace.kind === "solved") {
      expect(trace.path).toEqual([]);
      expect(trace.meanBranchingFactor).toBe(0);
      expect(trace.maxBranchingFactor).toBe(0);
      expect(trace.blockedAtStart).toBe(0);
    }
  });

  it("handles a multi-cell L-shaped arrow (U-body on 3×2)", () => {
    // Single arrow with 4 cells forming a U-turn:
    //   tail (0,0) → (0,1) → (1,1) → head (2,1), direction E
    // Head exits right wall. Tests that slitherOutcome on longer bodies
    // integrates correctly with solveTrace's legal-count loop.
    const paths: Path[] = [
      {
        id: 1,
        cells: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
          { x: 2, y: 1 },
        ],
      },
    ];
    const trace = solveTrace(3, 2, paths);
    expect(trace.kind).toBe("solved");
    if (trace.kind === "solved") {
      expect(trace.path).toEqual([{ x: 2, y: 1 }]);
      expect(trace.meanBranchingFactor).toBe(1);
      expect(trace.maxBranchingFactor).toBe(1);
      expect(trace.blockedAtStart).toBe(0);
    }
  });

  it("single arrow → solved with branching 1.0", () => {
    const paths: Path[] = [
      { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, // head east, exits right wall
    ];
    const trace = solveTrace(2, 1, paths);
    expect(trace.kind).toBe("solved");
    if (trace.kind === "solved") {
      expect(trace.path).toEqual([{ x: 1, y: 0 }]);
      expect(trace.meanBranchingFactor).toBe(1);
      expect(trace.maxBranchingFactor).toBe(1);
      expect(trace.blockedAtStart).toBe(0);
    }
  });

  it("two independent arrows → branching 2, 1 (both exits open at start)", () => {
    //   A: row 0 heading east, exits right wall
    //   B: row 1 heading east, exits right wall
    // At start, both are legal → legalCount=2. After popping A, only B
    // remains → legalCount=1.
    const paths: Path[] = [
      { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
      { id: 2, cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
    ];
    const trace = solveTrace(2, 2, paths);
    expect(trace.kind).toBe("solved");
    if (trace.kind === "solved") {
      // (2+1)/2 = 1.5
      expect(trace.meanBranchingFactor).toBe(1.5);
      expect(trace.maxBranchingFactor).toBe(2);
      expect(trace.blockedAtStart).toBe(0);
    }
  });
});

describe("solveTrace — L06-style spine-lock fixture", () => {
  // 8×1 grid with 4 arrows chained east-by-east. Each arrow's head is
  // blocked by the next arrow's tail; only the rightmost can exit
  // initially. Popping unlocks the next, and so on. Every step has
  // exactly one legal arrow — meanBF=1.0, maxBF=1.
  //
  // This is the minimal "ordering-constraint chain" that the reference
  // Arrows game's hard heart pictograms exhibit at scale. Our branching-
  // factor gate rejects levels whose mean branching exceeds a per-level
  // threshold; fixtures like this must pass with branching = 1.0.
  //
  //   col: 0   1   2   3   4   5   6   7
  //   arr: [A ─────] [B ─────] [C ─────] [D ─────]
  //   A head (1,0) E → blocked by B at (2,0)
  //   B head (3,0) E → blocked by C at (4,0)
  //   C head (5,0) E → blocked by D at (6,0)
  //   D head (7,0) E → exits right wall ✓
  //
  // Forced pop order: D, C, B, A.
  const spineLockPaths: Path[] = [
    { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    { id: 2, cells: [{ x: 2, y: 0 }, { x: 3, y: 0 }] },
    { id: 3, cells: [{ x: 4, y: 0 }, { x: 5, y: 0 }] },
    { id: 4, cells: [{ x: 6, y: 0 }, { x: 7, y: 0 }] },
  ];

  it("is solvable with meanBranchingFactor === 1.0", () => {
    const trace = solveTrace(8, 1, spineLockPaths);
    expect(trace.kind).toBe("solved");
    if (trace.kind === "solved") {
      expect(trace.meanBranchingFactor).toBe(1);
      expect(trace.maxBranchingFactor).toBe(1);
      expect(trace.blockedAtStart).toBe(3);
    }
  });

  it("greedy solution fires arrows in forced order D, C, B, A", () => {
    const trace = solveTrace(8, 1, spineLockPaths);
    expect(trace.kind).toBe("solved");
    if (trace.kind === "solved") {
      expect(trace.path).toEqual([
        { x: 7, y: 0 },
        { x: 5, y: 0 },
        { x: 3, y: 0 },
        { x: 1, y: 0 },
      ]);
    }
  });
});

describe("solveTrace — determinism baseline", () => {
  // Pins the canonical greedy solution path across a fixture set. Any
  // refactor of solver.ts that changes iteration or tiebreak will shift
  // the hash — and per the ADR, breaking this hash requires a
  // coordinated catalogue regeneration. The Python pipeline's validate.py
  // re-runs solveTrace at CI time against per-level thresholds recorded
  // at generation, so a drifted hash means every level's recorded
  // branching factor could be wrong.
  //
  // The fixtures below are chosen to exercise the branching-factor
  // measurement:
  //   - spineLock: 4-arrow forced chain, branching = 1
  //   - two-independent: branching = 1.5
  //   - one-arrow: branching = 1
  // If this test fails: confirm the change is intentional, update the
  // baseline, and open a catalogue-regeneration PR before merging.
  const BASELINE_SHA = "4693d20bbb762cb2ca21c60d457d719c03ed77c5";

  it("produces a stable hash over the fixture set", () => {
    const fixtures: Array<{ cols: number; rows: number; paths: Path[] }> = [
      {
        cols: 8,
        rows: 1,
        paths: [
          { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
          { id: 2, cells: [{ x: 2, y: 0 }, { x: 3, y: 0 }] },
          { id: 3, cells: [{ x: 4, y: 0 }, { x: 5, y: 0 }] },
          { id: 4, cells: [{ x: 6, y: 0 }, { x: 7, y: 0 }] },
        ],
      },
      {
        cols: 2,
        rows: 2,
        paths: [
          { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
          { id: 2, cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
        ],
      },
      {
        cols: 2,
        rows: 1,
        paths: [{ id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }],
      },
    ];

    const digest = createHash("sha1");
    for (const { cols, rows, paths } of fixtures) {
      const trace = solveTrace(cols, rows, paths);
      digest.update(JSON.stringify(trace));
    }
    const hash = digest.digest("hex");

    expect(hash).toBe(BASELINE_SHA);
  });
});

describe("solveTrace — consistency with solve() and validateLevel()", () => {
  // Sanity: solveTrace's solution path must equal solve()'s, and
  // solveTrace returning "solved" must imply validateLevel() === true.
  const paths: Path[] = [
    { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    { id: 2, cells: [{ x: 2, y: 0 }, { x: 3, y: 0 }] },
    { id: 3, cells: [{ x: 4, y: 0 }, { x: 5, y: 0 }] },
    { id: 4, cells: [{ x: 6, y: 0 }, { x: 7, y: 0 }] },
  ];

  it("solveTrace.path matches solve() output", () => {
    const trace = solveTrace(8, 1, paths);
    const greedy = solve(8, 1, paths);
    expect(trace.kind).toBe("solved");
    expect(greedy).not.toBeNull();
    if (trace.kind === "solved" && greedy !== null) {
      expect(trace.path).toEqual(greedy);
    }
  });

  it("solveTrace solved ⇒ validateLevel true", () => {
    const trace = solveTrace(8, 1, paths);
    expect(trace.kind).toBe("solved");
    expect(validateLevel(8, 1, paths)).toBe(true);
  });
});
