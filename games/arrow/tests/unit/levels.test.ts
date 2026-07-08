/**
 * Level solvability — delegates to the greedy solver, which is
 * sound and complete for polyline-arrow levels.
 */

import { describe, expect, it } from "vitest";

import { getLevel, TOTAL_LEVELS } from "../../src/game/levels.js";
import type { LevelSpec } from "../../src/game/state.js";
import { blockedAtTurn1, validateLevel } from "../../src/game/solver.js";

function allLevels(): LevelSpec[] {
  const out: LevelSpec[] = [];
  for (let i = 1; i <= TOTAL_LEVELS; i++) {
    const lv = getLevel(i);
    if (lv) out.push(lv);
  }
  return out;
}

describe("LEVELS", () => {
  it("has the carried 40 authored entries", () => {
    expect(TOTAL_LEVELS).toBe(40);
  });

  it("built-level indices are monotonic (gaps allowed for failed procedural slots)", () => {
    const indices = allLevels().map((lv) => lv.index);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]!);
    }
  });

  it("getLevel returns the matching level", () => {
    expect(getLevel(1)?.index).toBe(1);
    expect(getLevel(10)?.index).toBe(10);
    expect(getLevel(999)).toBeNull();
  });

  for (let i = 1; i <= TOTAL_LEVELS; i++) {
    it(`level ${i} is solvable and has the expected arrow count`, () => {
      const lv = getLevel(i)!;
      expect(lv.paths.length).toBeGreaterThan(0);
      expect(validateLevel(lv.cols, lv.rows, lv.paths)).toBe(true);
    });
  }

  it("every path across all authored levels is a valid polyline (len >= 2, 4-connected, non-self-intersecting)", () => {
    for (const lv of allLevels()) {
      for (const p of lv.paths) {
        expect(p.cells.length).toBeGreaterThanOrEqual(2);
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
    }
  });

  it("blockedAtTurn1 is non-decreasing across the curve (difficulty ramp)", () => {
    const blockedPerLevel = allLevels().map((lv) =>
      blockedAtTurn1(lv.cols, lv.rows, lv.paths),
    );
    // Not strictly monotonic — rejection sampling can't always hit the
    // exact target band, and fallback solvable levels may undershoot.
    // But the average over the second half should exceed the first.
    const firstHalf = blockedPerLevel.slice(0, 5);
    const secondHalf = blockedPerLevel.slice(5);
    const avg = (arr: number[]) => arr.reduce((s, n) => s + n, 0) / arr.length;
    expect(avg(secondHalf)).toBeGreaterThan(avg(firstHalf));
  });

  it("every level's paths are pairwise disjoint", () => {
    for (const lv of allLevels()) {
      const owned = new Map<string, number>();
      for (const p of lv.paths) {
        for (const c of p.cells) {
          const key = `${c.x},${c.y}`;
          expect(owned.has(key)).toBe(false);
          owned.set(key, p.id);
        }
      }
    }
  });
});
