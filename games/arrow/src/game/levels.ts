/**
 * Level registry — the authored recipes generated deterministically from yaml.
 *
 * Recipes live in `games/arrow/content/levels/*.yaml`; `content/level-tools/levels-gen.mjs`
 * compiles them to `src/game/levels-data.ts` (generated). Each recipe
 * is turned into a LevelSpec by generatePaths + validate. If the first
 * seed yields an unsolvable layout, perturb the seed and retry up to
 * RECIPE_RETRIES times.
 */

import { generatePaths } from "./path-generator.js";
import { blockedAtTurn1, solveBucket, validateLevel } from "./solver.js";
import type { LevelSpec } from "./state.js";
import { RECIPES } from "./levels-data.js";
import { CURRENT_SCHEMA_VERSION, isExplicitRecipe, type ExplicitRecipe, type LevelRecipe, type LevelTransform, type ProceduralRecipe } from "./levels-recipe.js";
import type { Path } from "./path.js";

const RECIPE_RETRIES_DEFAULT = 200;

function applyTransform(cols: number, rows: number, cells: ReadonlyArray<readonly [number, number]>, transform: LevelTransform): Array<[number, number]> {
  return cells.map(([x, y]) => {
    switch (transform) {
      case "mirror-x": return [cols - 1 - x, y];
      case "mirror-y": return [x, rows - 1 - y];
      case "rotate-180": return [cols - 1 - x, rows - 1 - y];
    }
  });
}

function buildExplicitLevel(index: number, r: ExplicitRecipe): LevelSpec {
  const allArrows: Array<Array<[number, number]>> = r.arrows.map((cells) => cells.map(([x, y]) => [x, y] as [number, number]));
  if (r.transform) {
    for (const cells of r.arrows) {
      allArrows.push(applyTransform(r.cols, r.rows, cells, r.transform));
    }
  }
  const paths: Path[] = allArrows.map((cells, i) => ({ id: i + 1, cells: cells.map(([x, y]) => ({ x, y })) }));
  if (!validateLevel(r.cols, r.rows, paths)) {
    throw new Error(`buildExplicitLevel: level ${index} is unsolvable as authored`);
  }
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    index,
    cols: r.cols,
    rows: r.rows,
    paths,
    pack: r.meta.pack,
    indexInPack: r.meta.indexInPack,
    title: r.meta.title,
    difficulty: r.meta.difficulty,
  };
}

function buildProceduralLevel(index: number, r: ProceduralRecipe): LevelSpec {
  const RECIPE_RETRIES = r.seedSweep ?? RECIPE_RETRIES_DEFAULT;
  // First pass: prefer seeds that land in the blockedT1 band.
  // Fallback pass: any solvable layout wins, even if outside the band
  // (so the level is always playable — we accept an "easier or harder
  // than intended" level over a blank one).
  let fallback: LevelSpec | null = null;
  // When blockedT1 is omitted, every solvable layout qualifies — no
  // first-pass/fallback distinction needed.
  const band = r.blockedT1;
  // Mix the recipe's flat index into the perturbation so two recipes
  // whose base seeds happen to differ by a multiple of 1000003 can't
  // share retry trajectories (reviewer R1.1). 0x9E3779B1 is the golden-
  // ratio prime commonly used for hash mixing; XOR is cheap and keeps
  // the mask value bounded to <2^32 so the final u32 stays stable.
  const baseMixed = (r.seed ^ ((index * /* hex-allow: golden-ratio prime */ 0x9E3779B1) >>> 0)) >>> 0;
  for (let attempt = 0; attempt < RECIPE_RETRIES; attempt++) {
    const seed = baseMixed + attempt * 1000003;
    try {
      const { paths } = generatePaths(r.cols, r.rows, r.arrowCount, r.opts, seed);
      if (!validateLevel(r.cols, r.rows, paths)) continue;
      // solverCheck gates the bucket. "unique" requires exactly 1 order,
      // "near-unique" accepts 1..cap-1, "solvable" (default) accepts any
      // solvable layout — validateLevel already covers that case.
      if (r.solverCheck === "unique" || r.solverCheck === "near-unique") {
        const bucket = solveBucket(r.cols, r.rows, paths);
        if (r.solverCheck === "unique" && bucket !== "unique") continue;
        if (r.solverCheck === "near-unique" && bucket !== "unique" && bucket !== "near-unique") continue;
      }
      const spec: LevelSpec = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        index,
        cols: r.cols,
        rows: r.rows,
        paths,
        pack: r.meta.pack,
        indexInPack: r.meta.indexInPack,
        title: r.meta.title,
        difficulty: r.meta.difficulty,
      };
      if (!band) return spec;
      const blocked = blockedAtTurn1(r.cols, r.rows, paths);
      if (blocked >= band[0] && blocked <= band[1]) return spec;
      if (fallback === null) fallback = spec;
    } catch (err) {
      // Only swallow layout-exhaustion. Anything else (TypeError,
      // validator mismatch) indicates a programmer bug — surface it
      // instead of burning 200 silent retries on a broken code path.
      if (!(err instanceof Error) || !/generatePaths: failed to place arrow/.test(err.message)) {
        throw err;
      }
    }
  }
  if (fallback) return fallback;
  throw new Error(
    `buildLevel: could not generate any solvable level ${index} after ${RECIPE_RETRIES} seeds (base=${r.seed})`,
  );
}

export function buildLevel(index: number, r: LevelRecipe): LevelSpec {
  return isExplicitRecipe(r) ? buildExplicitLevel(index, r) : buildProceduralLevel(index, r);
}

// Dev builds throw on recipe failures so a bad yaml surfaces
// immediately; prod builds degrade to a null slot so one broken level
// can't brick the whole game. With 100 recipes incoming, silent
// console.error in dev is too easy to miss.
// DEV here means "`npm run dev` page-load" — NOT vitest. Tests inherit
// Vite's DEV=true but MODE='test'; we exclude them so a failing recipe
// under test surfaces as a targeted test failure, not an import-time
// crash cascading through every suite that imports levels.ts.
const IS_DEV = (() => {
  const env = (import.meta as unknown as { env?: { DEV?: boolean; MODE?: string } }).env;
  return env?.DEV === true && env.MODE !== "test";
})();

/**
 * Eagerly build all levels at module-load. Failures become null slots
 * in prod (getLevel returns null) so a broken recipe doesn't take down
 * the whole import; in dev they throw so the author sees the bad yaml
 * at page-load instead of next-level-advance.
 */
const BUILT: ReadonlyArray<LevelSpec | null> = RECIPES.map((r, i) => {
  try {
    return buildLevel(i + 1, r);
  } catch (err) {
    if (IS_DEV) throw err;
    console.error(`[arrow] failed to build level ${i + 1}:`, err);
    return null;
  }
});

export const TOTAL_LEVELS = RECIPES.length;

export function getLevel(index: number): LevelSpec | null {
  if (index < 1 || index > RECIPES.length) return null;
  return BUILT[index - 1] ?? null;
}

export function nextLevelIndex(current: number): number {
  return Math.min(current + 1, RECIPES.length);
}
