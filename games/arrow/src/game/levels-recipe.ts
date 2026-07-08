/**
 * Types for a LevelRecipe — the shape a single yaml file compiles to.
 * Split out from the generated levels-data.ts so the interface can
 * evolve (JSDoc tweaks, readonly variants) without a regen cycle
 * failing the --check drift guard.
 */

import type { GenOptions } from "./path-generator.js";

/**
 * Current recipe/LevelSpec schema version. Bump when making a breaking
 * change to the on-disk YAML shape; write a v{N-1}-to-v{N}.py migration
 * under content/level-tools/schema-migrations/ and update the loader guard.
 * Absent-in-YAML is treated as v1 (legacy corpus pre-dates the field).
 */
export const CURRENT_SCHEMA_VERSION = 1 as const;
export type SchemaVersion = typeof CURRENT_SCHEMA_VERSION;

export interface LevelRecipeMeta {
  readonly pack: string;
  readonly indexInPack: number;
  readonly title?: string;
  readonly difficulty?: "easy" | "medium" | "hard";
}

export type SolverCheck = "solvable" | "unique" | "near-unique";
export type LevelTransform = "mirror-x" | "mirror-y" | "rotate-180";

/** Procedural mode: generator + solver build paths from a seed. */
export interface ProceduralRecipe {
  readonly schemaVersion?: SchemaVersion;
  readonly cols: number;
  readonly rows: number;
  readonly arrowCount: number;
  readonly opts: GenOptions;
  readonly seed: number;
  readonly blockedT1?: readonly [number, number];
  readonly solverCheck?: SolverCheck;
  readonly seedSweep?: number;
  readonly meta: LevelRecipeMeta;
}

/** Explicit mode: author provides the full arrow list; solver validates. */
export interface ExplicitRecipe {
  readonly schemaVersion?: SchemaVersion;
  readonly cols: number;
  readonly rows: number;
  readonly arrows: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  readonly transform?: LevelTransform;
  readonly meta: LevelRecipeMeta;
}

export type LevelRecipe = ProceduralRecipe | ExplicitRecipe;
export function isExplicitRecipe(r: LevelRecipe): r is ExplicitRecipe {
  return "arrows" in r;
}

export interface LevelPack {
  readonly slug: string;
  readonly indices: ReadonlyArray<number>;
  readonly firstTitle: string;
}
