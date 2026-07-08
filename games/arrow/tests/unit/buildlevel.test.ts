/**
 * buildLevel — fallback branch + RECIPE_RETRIES ceiling coverage.
 *
 * The function isn't exercised by levels.test.ts in isolation; those
 * tests only see the final BUILT array. Injecting synthetic recipes
 * proves the retry loop lands on a solvable spec even when the band
 * constraint can't be met, and throws when no seed produces one.
 */

import { describe, expect, it } from "vitest";

import { buildLevel } from "../../src/game/levels.js";
import type { LevelRecipe } from "../../src/game/levels-recipe.js";

function mkRecipe(overrides: Partial<LevelRecipe> = {}): LevelRecipe {
  return {
    cols: 5,
    rows: 7,
    arrowCount: 3,
    opts: { minLen: 2, maxLen: 3, bendProb: 0.1 },
    seed: 101,
    blockedT1: [0, 1],
    meta: { pack: "test", indexInPack: 1 },
    ...overrides,
  };
}

describe("buildLevel", () => {
  it("returns a solvable LevelSpec for a reasonable recipe", () => {
    const spec = buildLevel(1, mkRecipe());
    expect(spec.index).toBe(1);
    expect(spec.paths.length).toBeGreaterThan(0);
    expect(spec.pack).toBe("test");
    expect(spec.indexInPack).toBe(1);
  });

  it("falls back to first-solvable when blockedT1 band is unreachable", () => {
    // Band [99, 99] can never be hit on a 3-arrow grid. Solver should
    // still return the first solvable layout (fallback path).
    const spec = buildLevel(2, mkRecipe({ blockedT1: [99, 99] }));
    expect(spec.paths.length).toBe(3);
  });

  it("throws when no seed produces a solvable layout", () => {
    // arrowCount > available cells → generator exhausts PATH_RETRY_BUDGET
    // on every seed. buildLevel's outer 200 retries all fail.
    expect(() =>
      buildLevel(3, mkRecipe({ cols: 3, rows: 3, arrowCount: 50, opts: { minLen: 2, maxLen: 3, bendProb: 0 } })),
    ).toThrow(/could not generate any solvable level/);
  });

  it("threads meta.title and difficulty onto the LevelSpec", () => {
    const spec = buildLevel(4, mkRecipe({ meta: { pack: "p", indexInPack: 2, title: "T", difficulty: "hard" } }));
    expect(spec.title).toBe("T");
    expect(spec.difficulty).toBe("hard");
  });
});
