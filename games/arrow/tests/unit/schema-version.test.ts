/**
 * Contract tests for the schemaVersion: 1 migration (card UK2vn6TJ).
 *
 * - Loader must accept `schemaVersion: 1` explicitly.
 * - Loader must accept absent-schemaVersion as v1 (legacy corpus).
 * - Loader must throw loudly on any other numeric version — forward-compat
 *   is not silent; bumping the version requires a migration script under
 *   content/level-tools/schema-migrations/.
 */

import { describe, expect, it } from "vitest";

// @ts-expect-error — JS module without types; we treat the exports as unknown.
import { parseYaml, validateRecipe, CURRENT_SCHEMA_VERSION as MJS_VERSION } from "../../content/level-tools/levels-gen.mjs";
import { CURRENT_SCHEMA_VERSION as TS_VERSION } from "../../src/game/levels-recipe.js";

const RECIPE_BASE = `cols: 4
rows: 5
arrowCount: 2
opts:
  minLen: 2
  maxLen: 3
  bendProb: 0.0
seed: 99001
meta:
  pack: first-steps
  indexInPack: 1
`;

describe("levels-gen schemaVersion guard", () => {
  it("accepts absent schemaVersion as v1 (legacy corpus)", () => {
    const raw = parseYaml(RECIPE_BASE, "test.yaml");
    expect(() => validateRecipe(raw, "test.yaml")).not.toThrow();
  });

  it("accepts explicit schemaVersion: 1", () => {
    const raw = parseYaml(`schemaVersion: 1\n${RECIPE_BASE}`, "test.yaml");
    expect(raw.schemaVersion).toBe(1);
    expect(() => validateRecipe(raw, "test.yaml")).not.toThrow();
  });

  it("throws on unsupported schemaVersion: 2", () => {
    const raw = parseYaml(`schemaVersion: 2\n${RECIPE_BASE}`, "test.yaml");
    expect(() => validateRecipe(raw, "test.yaml")).toThrow(/unsupported schemaVersion/);
  });

  it("throws on schemaVersion: 0", () => {
    const raw = parseYaml(`schemaVersion: 0\n${RECIPE_BASE}`, "test.yaml");
    expect(() => validateRecipe(raw, "test.yaml")).toThrow(/unsupported schemaVersion/);
  });

  it("TS and JS CURRENT_SCHEMA_VERSION constants agree (drift guard)", () => {
    // Two independent constants (levels-recipe.ts for runtime types;
    // levels-gen.mjs for build-time validation) — this test catches a
    // future bump that forgets one side.
    expect(MJS_VERSION).toBe(TS_VERSION);
  });
});
