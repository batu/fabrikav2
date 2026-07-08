import { describe, expect, it } from "vitest";

import { cellOwner, type Path } from "../../src/game/path.js";
import { generatePaths } from "../../src/game/path-generator.js";

const OPTS = { minLen: 2, maxLen: 5, bendProb: 0.3 } as const;

function cellKeys(p: Path): string[] {
  return p.cells.map((c) => `${c.x},${c.y}`);
}

describe("generatePaths — determinism", () => {
  it("produces identical path sets for the same seed", () => {
    const a = generatePaths(6, 8, 4, OPTS, 12345);
    const b = generatePaths(6, 8, 4, OPTS, 12345);
    expect(a.paths.map(cellKeys)).toEqual(b.paths.map(cellKeys));
  });

  it("produces different path sets for different seeds", () => {
    const a = generatePaths(6, 8, 4, OPTS, 1);
    const b = generatePaths(6, 8, 4, OPTS, 2);
    expect(a.paths.map(cellKeys)).not.toEqual(b.paths.map(cellKeys));
  });

  it("seed=0 is a distinct valid seed (no collision with fallback constant)", () => {
    const a = generatePaths(6, 8, 4, OPTS, 0);
    const b = generatePaths(6, 8, 4, OPTS, 1);
    expect(a.paths.map(cellKeys)).not.toEqual(b.paths.map(cellKeys));
    // And repeatable: seed=0 twice is identical.
    const c = generatePaths(6, 8, 4, OPTS, 0);
    expect(a.paths.map(cellKeys)).toEqual(c.paths.map(cellKeys));
  });

  it("negative seeds are accepted and distinct", () => {
    const a = generatePaths(6, 8, 4, OPTS, -1);
    const b = generatePaths(6, 8, 4, OPTS, 1);
    expect(a.paths.map(cellKeys)).not.toEqual(b.paths.map(cellKeys));
  });
});

describe("generatePaths — invariants", () => {
  it("places exactly arrowCount paths on the returned grid", () => {
    const r = generatePaths(6, 8, 4, OPTS, 7);
    expect(r.paths.length).toBe(4);
    expect(r.grid.arrows.size).toBe(4);
  });

  it("every generated path has length within [minLen, maxLen]", () => {
    const r = generatePaths(8, 8, 5, { minLen: 3, maxLen: 6, bendProb: 0.4 }, 42);
    for (const p of r.paths) {
      expect(p.cells.length).toBeGreaterThanOrEqual(3);
      expect(p.cells.length).toBeLessThanOrEqual(6);
    }
  });

  it("every generated path is 4-connected and non-self-intersecting", () => {
    const r = generatePaths(6, 8, 4, OPTS, 99);
    for (const p of r.paths) {
      const seen = new Set<string>();
      for (let i = 0; i < p.cells.length; i++) {
        const c = p.cells[i]!;
        const key = `${c.x},${c.y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        if (i > 0) {
          const prev = p.cells[i - 1]!;
          const dx = Math.abs(c.x - prev.x);
          const dy = Math.abs(c.y - prev.y);
          expect(dx + dy).toBe(1);
        }
      }
    }
  });

  it("all generated paths are pairwise disjoint (enforced by placePath)", () => {
    const r = generatePaths(7, 9, 6, OPTS, 31);
    const owned = new Map<string, number>();
    for (const p of r.paths) {
      for (const c of p.cells) {
        const key = `${c.x},${c.y}`;
        expect(owned.has(key)).toBe(false);
        owned.set(key, p.id);
      }
    }
    // And cellIndex on the grid matches.
    for (const [key, id] of owned) {
      const [xs, ys] = key.split(",");
      expect(cellOwner(r.grid, Number(xs), Number(ys))).toBe(id);
    }
  });

  it("path ids are 1..arrowCount in order", () => {
    const r = generatePaths(5, 8, 3, OPTS, 11);
    expect(r.paths.map((p) => p.id)).toEqual([1, 2, 3]);
  });
});

describe("generatePaths — option validation", () => {
  it("throws when minLen < 2", () => {
    expect(() => generatePaths(5, 5, 1, { minLen: 1, maxLen: 3, bendProb: 0.3 }, 1)).toThrow(
      /minLen must be >= 2/,
    );
  });

  it("throws when maxLen < minLen", () => {
    expect(() => generatePaths(5, 5, 1, { minLen: 4, maxLen: 3, bendProb: 0.3 }, 1)).toThrow(
      /maxLen.*< minLen/,
    );
  });
});

describe("generatePaths — failure modes", () => {
  it("throws when arrowCount is too high for the grid", () => {
    // 3x3 = 9 cells, minLen 2 → at most 4 arrows fit; 10 is impossible.
    expect(() =>
      generatePaths(3, 3, 10, { minLen: 2, maxLen: 2, bendProb: 0 }, 1),
    ).toThrow(/failed to place arrow/);
  });
});
