#!/usr/bin/env node
/**
 * levels-gen.mjs — yaml → src/game/levels-data.ts
 *
 * Reads recursive yaml recipes under content/levels in filename-sorted order, validates shape/ranges,
 * emits a typed RECIPES array. Run via `npm run levels:gen`. Pass
 * `--check` to fail (exit 1) if the committed generated file differs
 * from what the current yamls would produce — use in CI to block
 * edit-yaml-forget-to-regen drift.
 *
 * Intentionally no third-party YAML library — the recipe format is a
 * small, flat subset (ints, floats, one nested map, one tuple array).
 * A bespoke line-oriented parser keeps the toolchain zero-dep. When the
 * schema grows beyond what this handles, swap to `yaml` (npm).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// When imported by vitest, import.meta.url may not be a file:// scheme;
// fall back to the cwd so module import doesn't crash. The paths are
// only used by main() which isn't invoked during tests.
let HERE = process.cwd();
try { HERE = fileURLToPath(new URL(".", import.meta.url)); } catch {}
const GAME_ROOT = join(HERE, "..", "..");
const LEVELS_DIR = join(GAME_ROOT, "content/levels");
const OUT = join(GAME_ROOT, "src/game/levels-data.ts");

// Keys whose top-level value is a nested map (nothing after the colon).
// Listed explicitly so `seed:` with missing value throws instead of
// being mis-parsed as an empty-map placeholder.
const MAP_KEYS = new Set(["opts", "meta"]);

/** Current on-disk recipe schema version. Loader accepts absent as v1
 *  (legacy corpus pre-migration) but rejects any other number. Bump in
 *  lockstep with a content/level-tools/schema-migrations/v{N-1}-to-v{N}.py migration. */
const CURRENT_SCHEMA_VERSION = 1;

// Meta-field value types. Keys not listed here are rejected.
const META_FIELD_KIND = {
  pack: "string",
  indexInPack: "number",
  title: "string",
  difficulty: "string", // enum-validated later
};
const DIFFICULTY_VALUES = new Set(["easy", "medium", "hard"]);
const SOLVER_CHECK_VALUES = new Set(["solvable", "unique", "near-unique"]);
const TRANSFORM_VALUES = new Set(["mirror-x", "mirror-y", "rotate-180"]);

function parseNumber(raw, filename, context) {
  if (raw === "") throw new Error(`${filename}: ${context} has empty value (expected number)`);
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`${filename}: ${context} is not a number: ${JSON.stringify(raw)}`);
  return n;
}

// Parse an unquoted scalar string. Strips surrounding quotes if present.
// Rejects empty. Used for meta.pack / meta.title / meta.difficulty.
function parseString(raw, filename, context) {
  if (raw === "") throw new Error(`${filename}: ${context} has empty value (expected string)`);
  // Allow "..." or '...' but unwrap.
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseYaml(src, filename) {
  const out = {};
  let currentKey = null;
  // Strip UTF-8 BOM if present (editors sometimes add one).
  const clean = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  for (const rawLine of clean.split("\n")) {
    // Strip comments at the first unquoted # preceded by whitespace
    // (or start-of-line). A quoted span is whatever sits between a
    // balanced pair of " or '. The whitespace-guard keeps `-foo` safe.
    // Needed for meta.title values like `"Hash # Tag"` that legitimately
    // contain # inside quotes.
    let hashIdx = -1;
    {
      let quote = null;
      for (let k = 0; k < rawLine.length; k++) {
        const ch = rawLine[k];
        if (quote) {
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === "#" && (k === 0 || /\s/.test(rawLine[k - 1]))) { hashIdx = k; break; }
      }
    }
    const noComment = hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine;
    const line = noComment.replace(/\s+$/, "");
    if (!line) continue;
    if (/\t/.test(line)) throw new Error(`${filename}: tabs are not supported — use 2 spaces`);
    const indentMatch = line.match(/^( *)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    const body = line.slice(indent);
    const colon = body.indexOf(":");
    if (colon < 0) throw new Error(`${filename}: expected 'key: value', got ${JSON.stringify(body)}`);
    const key = body.slice(0, colon).trim();
    const value = body.slice(colon + 1).trim();
    if (indent === 0) {
      currentKey = key;
      if (value === "") {
        if (!MAP_KEYS.has(key)) {
          throw new Error(`${filename}: '${key}' is missing a value (did you mean '${key}: 0' or a nested map?)`);
        }
        out[key] = {};
      } else if (key === "arrows" && value.startsWith("[")) {
        // Explicit-arrows authoring mode: JSON-parse the whole value.
        // Expected shape: [[[x,y], [x,y], ...], [[x,y], ...], ...]
        try { out[key] = JSON.parse(value); }
        catch (e) { throw new Error(`${filename}: arrows must be a JSON array of cell-arrays (${e.message})`); }
      } else if (key === "transform" || key === "solverCheck") {
        // Top-level enum-string keys.
        out[key] = parseString(value, filename, key);
      } else if (value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1).trim();
        if (inner === "") throw new Error(`${filename}: ${key} is an empty sequence`);
        out[key] = inner.split(",").map((n, i) => parseNumber(n.trim(), filename, `${key}[${i}]`));
      } else {
        out[key] = parseNumber(value, filename, key);
      }
    } else if (indent === 2) {
      if (!currentKey || typeof out[currentKey] !== "object" || Array.isArray(out[currentKey])) {
        throw new Error(`${filename}: nested '${key}' without a parent map`);
      }
      const ctx = `${currentKey}.${key}`;
      if (currentKey === "meta") {
        const kind = META_FIELD_KIND[key];
        if (!kind) throw new Error(`${filename}: unknown meta field '${key}'`);
        out.meta[key] = kind === "number" ? parseNumber(value, filename, ctx) : parseString(value, filename, ctx);
      } else if (value.startsWith("[") && value.endsWith("]")) {
        // Flow-sequence value inside a nested map (e.g. opts.lenDist).
        const inner = value.slice(1, -1).trim();
        if (inner === "") throw new Error(`${filename}: ${ctx} is an empty sequence`);
        out[currentKey][key] = inner.split(",").map((n, i) => parseNumber(n.trim(), filename, `${ctx}[${i}]`));
      } else {
        out[currentKey][key] = parseNumber(value, filename, ctx);
      }
    } else {
      throw new Error(`${filename}: only 0-space and 2-space indent supported, got ${indent}`);
    }
  }
  return out;
}

function validateExplicitArrows(raw, filename, check) {
  const owned = new Map(); // "x,y" → arrow index
  for (let i = 0; i < raw.arrows.length; i++) {
    const a = raw.arrows[i];
    if (!Array.isArray(a) || a.length < 2) {
      check(false, `arrows[${i}] must be an array of length >= 2 (got ${JSON.stringify(a)})`);
      continue;
    }
    for (let j = 0; j < a.length; j++) {
      const c = a[j];
      if (!Array.isArray(c) || c.length !== 2 || !Number.isInteger(c[0]) || !Number.isInteger(c[1])) {
        check(false, `arrows[${i}][${j}] must be [x,y] with integer coords`);
        continue;
      }
      if (c[0] < 0 || c[0] >= raw.cols || c[1] < 0 || c[1] >= raw.rows) {
        check(false, `arrows[${i}][${j}] (${c[0]},${c[1]}) out of bounds for ${raw.cols}x${raw.rows}`);
      }
      const key = `${c[0]},${c[1]}`;
      if (owned.has(key)) check(false, `arrows[${i}] cell (${key}) overlaps arrow ${owned.get(key)}`);
      owned.set(key, i);
      if (j > 0) {
        const prev = a[j - 1];
        const dx = Math.abs(c[0] - prev[0]);
        const dy = Math.abs(c[1] - prev[1]);
        if (dx + dy !== 1) check(false, `arrows[${i}] step ${j - 1}→${j} not 4-connected`);
      }
    }
  }
}

function validateRecipe(raw, filename) {
  const errors = [];
  const check = (cond, msg) => { if (!cond) errors.push(msg); };
  // schemaVersion is optional (absent = v1 for legacy corpus). Any value
  // other than CURRENT_SCHEMA_VERSION is rejected loudly — forward-compat
  // is intentionally not silent; bump the constant with a migration.
  if (raw.schemaVersion !== undefined) {
    if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `${filename}: unsupported schemaVersion ${JSON.stringify(raw.schemaVersion)} (expected ${CURRENT_SCHEMA_VERSION}). Run content/level-tools/schema-migrations/v{N-1}-to-v{N}.py.`,
      );
    }
  }
  check(Number.isInteger(raw.cols) && raw.cols >= 3 && raw.cols <= 30, "cols must be int in [3, 30]");
  check(Number.isInteger(raw.rows) && raw.rows >= 3 && raw.rows <= 30, "rows must be int in [3, 30]");
  // Two authoring modes: procedural (arrowCount + opts + seed) and
  // explicit (arrows list). Exactly one must be present.
  const hasExplicit = raw.arrows !== undefined;
  const hasProcedural = raw.arrowCount !== undefined || raw.opts !== undefined || raw.seed !== undefined;
  check(hasExplicit !== hasProcedural, "recipe must use either 'arrows: [...]' OR 'arrowCount+opts+seed', not both");
  if (hasExplicit) {
    check(Array.isArray(raw.arrows) && raw.arrows.length >= 1, "arrows must be non-empty array");
    if (Array.isArray(raw.arrows)) validateExplicitArrows(raw, filename, check);
    if (raw.transform !== undefined) check(TRANSFORM_VALUES.has(raw.transform), "transform must be mirror-x | mirror-y | rotate-180");
    if (errors.length > 0) throw new Error(`${filename}:\n  ${errors.join("\n  ")}`);
    return; // Skip the procedural-only validators below.
  }
  check(Number.isInteger(raw.arrowCount) && raw.arrowCount >= 1, "arrowCount must be positive int");
  check(typeof raw.opts === "object" && raw.opts !== null, "opts must be a map");
  if (raw.opts) {
    // path-generator.ts rejects minLen < 2 at runtime; tighten here so
    // the failure surfaces at gen time instead of as a silent null slot.
    check(Number.isInteger(raw.opts.minLen) && raw.opts.minLen >= 2, "opts.minLen must be int >= 2");
    check(Number.isInteger(raw.opts.maxLen) && raw.opts.maxLen >= raw.opts.minLen, "opts.maxLen must be int >= minLen");
    check(typeof raw.opts.bendProb === "number" && raw.opts.bendProb >= 0 && raw.opts.bendProb <= 1, "opts.bendProb in [0, 1]");
    if (raw.opts.lenDist !== undefined) {
      check(
        Array.isArray(raw.opts.lenDist) &&
          raw.opts.lenDist.length >= 1 &&
          raw.opts.lenDist.every((w) => typeof w === "number" && w >= 0),
        "opts.lenDist must be a non-empty array of non-negative numbers",
      );
    }
  }
  // Positive-only, bounded to avoid overflow in levels.ts's fallback
  // perturbation (seed + attempt*1000003 stays within int32 for attempt<200).
  check(Number.isInteger(raw.seed) && raw.seed >= 0 && raw.seed < 2 ** 30, "seed must be int in [0, 2^30)");
  // blockedT1 is optional. Omit to accept any blocked-at-turn-1 count;
  // authors only care to constrain it on a subset of recipes.
  if (raw.blockedT1 !== undefined) {
    check(
      Array.isArray(raw.blockedT1) &&
        raw.blockedT1.length === 2 &&
        Number.isInteger(raw.blockedT1[0]) &&
        Number.isInteger(raw.blockedT1[1]) &&
        raw.blockedT1[0] <= raw.blockedT1[1],
      "blockedT1 must be [min, max] int tuple with min <= max",
    );
  }
  check(typeof raw.meta === "object" && raw.meta !== null, "meta must be a map");
  if (raw.meta) {
    check(typeof raw.meta.pack === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.meta.pack), "meta.pack must be kebab-case slug");
    check(Number.isInteger(raw.meta.indexInPack) && raw.meta.indexInPack >= 1 && raw.meta.indexInPack <= 99, "meta.indexInPack must be int in [1, 99]");
    if (raw.meta.title !== undefined) {
      check(typeof raw.meta.title === "string" && raw.meta.title.length > 0 && raw.meta.title.length <= 60, "meta.title must be 1..60 chars");
    }
    if (raw.meta.difficulty !== undefined) {
      check(DIFFICULTY_VALUES.has(raw.meta.difficulty), "meta.difficulty must be easy | medium | hard");
    }
  }
  // Cross-field sanity — catches author typos before they become
  // null slots at module-load. E.g. blockedT1:[0,100] on a 3-arrow
  // recipe silently accepts a band that can never be hit.
  if (raw.blockedT1 && Array.isArray(raw.blockedT1) && Number.isInteger(raw.arrowCount)) {
    check(raw.blockedT1[0] >= 0, "blockedT1[0] must be >= 0");
    check(raw.blockedT1[1] <= raw.arrowCount, "blockedT1[1] must be <= arrowCount");
  }
  // Warn-only: maxLen > min(cols, rows) guarantees path-generator
  // exhausts retries every time → null slot in prod. We can't
  // always block (diagonal paths may fit), so just flag suspicious.
  if (raw.opts && Number.isInteger(raw.opts.maxLen) && Number.isInteger(raw.cols) && Number.isInteger(raw.rows)) {
    if (raw.opts.maxLen > raw.cols * raw.rows - raw.arrowCount + 1) {
      errors.push(`opts.maxLen (${raw.opts.maxLen}) is larger than available cells for ${raw.arrowCount} arrows on ${raw.cols}×${raw.rows}`);
    }
  }
  // Reject unknown top-level + unknown opts keys. Without this, a
  // typo like `bendPrb: 0.3` silently uses default, and the recipe
  // ships with the wrong difficulty.
  // solverCheck gates the per-recipe solution-multiplicity expectation;
  // default "solvable" accepts any layout with ≥1 ordering.
  if (raw.solverCheck !== undefined) {
    check(SOLVER_CHECK_VALUES.has(raw.solverCheck), "solverCheck must be solvable | unique | near-unique");
  }
  if (raw.seedSweep !== undefined) {
    check(Number.isInteger(raw.seedSweep) && raw.seedSweep >= 50 && raw.seedSweep <= 2000, "seedSweep must be int in [50, 2000]");
  }
  const ALLOWED_TOP = new Set(["schemaVersion", "cols", "rows", "arrowCount", "opts", "seed", "blockedT1", "meta", "solverCheck", "seedSweep", "arrows", "transform"]);
  for (const k of Object.keys(raw)) {
    if (!ALLOWED_TOP.has(k)) errors.push(`unknown top-level key '${k}'`);
  }
  if (raw.opts && typeof raw.opts === "object") {
    const ALLOWED_OPTS = new Set(["minLen", "maxLen", "bendProb", "lenDist"]);
    for (const k of Object.keys(raw.opts)) {
      if (!ALLOWED_OPTS.has(k)) errors.push(`unknown opts key '${k}'`);
    }
  }
  if (errors.length > 0) throw new Error(`${filename}:\n  ${errors.join("\n  ")}`);
}

function emitMeta(m) {
  const parts = [`pack: ${JSON.stringify(m.pack)}`, `indexInPack: ${m.indexInPack}`];
  if (m.title !== undefined) parts.push(`title: ${JSON.stringify(m.title)}`);
  if (m.difficulty !== undefined) parts.push(`difficulty: ${JSON.stringify(m.difficulty)}`);
  return `{ ${parts.join(", ")} }`;
}

function emitTs(recipes) {
  const lines = recipes.map((r) => {
    const parts = [
      `cols: ${r.cols}`,
      `rows: ${r.rows}`,
    ];
    if (r.arrows) {
      const arrowsLit = JSON.stringify(r.arrows).replace(/\[/g, "[").replace(/\]/g, "]");
      parts.push(`arrows: ${arrowsLit}`);
      if (r.transform) parts.push(`transform: ${JSON.stringify(r.transform)}`);
    } else {
      parts.push(`arrowCount: ${r.arrowCount}`);
      parts.push(
        r.opts.lenDist
          ? `opts: { minLen: ${r.opts.minLen}, maxLen: ${r.opts.maxLen}, bendProb: ${r.opts.bendProb}, lenDist: [${r.opts.lenDist.join(", ")}] }`
          : `opts: { minLen: ${r.opts.minLen}, maxLen: ${r.opts.maxLen}, bendProb: ${r.opts.bendProb} }`,
      );
      parts.push(`seed: ${r.seed}`);
      if (r.blockedT1) parts.push(`blockedT1: [${r.blockedT1[0]}, ${r.blockedT1[1]}]`);
      if (r.solverCheck) parts.push(`solverCheck: ${JSON.stringify(r.solverCheck)}`);
      if (r.seedSweep) parts.push(`seedSweep: ${r.seedSweep}`);
    }
    parts.push(`meta: ${emitMeta(r.meta)}`);
    return `  { ${parts.join(", ")} },`;
  });

  // Group recipes into packs in their already-sorted order.
  const packMap = new Map();
  for (const r of recipes) {
    if (!packMap.has(r.meta.pack)) packMap.set(r.meta.pack, []);
    packMap.get(r.meta.pack).push(r);
  }
  const packEntries = [];
  let flatIdx = 0;
  for (const [slug, rs] of packMap) {
    const indices = rs.map(() => flatIdx++);
    const firstTitle = rs[0].meta.title ?? slug;
    packEntries.push(
      `  { slug: ${JSON.stringify(slug)}, indices: [${indices.join(", ")}], firstTitle: ${JSON.stringify(firstTitle)} },`,
    );
  }
  return `// GENERATED — run \`npm run levels:gen\`. Source: content/levels/**/*.yaml.
import type { LevelRecipe, LevelPack } from "./levels-recipe.js";

export type { LevelRecipe, LevelPack } from "./levels-recipe.js";

export const RECIPES: ReadonlyArray<LevelRecipe> = [
${lines.join("\n")}
];

export const PACKS: ReadonlyArray<LevelPack> = [
${packEntries.join("\n")}
];
`;
}

// Filename must be NN-<slug>.yaml (2-digit zero-pad). The 2-digit cap
// is enough for up to 99 levels per pack; matches meta.indexInPack.
const LEVEL_FILENAME = /^\d{2}-[a-z0-9]+(-[a-z0-9]+)*\.yaml$/;

// Discover yaml recipes under content/levels/. Accepts either flat layout
// (*.yaml — legacy) or subdir layout (<pack>/*.yaml).
function discoverRecipes() {
  const results = [];
  for (const entry of readdirSync(LEVELS_DIR).sort()) {
    const abs = join(LEVELS_DIR, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const sub of readdirSync(abs).sort()) {
        if (!sub.endsWith(".yaml")) continue;
        if (!LEVEL_FILENAME.test(sub)) {
          throw new Error(`${entry}/${sub}: filename must match NN-<slug>.yaml (2-digit zero-pad)`);
        }
        results.push({ relPath: `${entry}/${sub}`, abs: join(abs, sub) });
      }
    } else if (entry.endsWith(".yaml")) {
      if (!LEVEL_FILENAME.test(entry)) {
        throw new Error(`${entry}: filename must match NN-<slug>.yaml (2-digit zero-pad)`);
      }
      results.push({ relPath: entry, abs });
    }
  }
  return results;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const files = discoverRecipes();
  if (files.length === 0) {
    console.error("levels-gen: no *.yaml files under content/levels/");
    process.exit(1);
  }

  const seenSeeds = new Set();
  const seenPackIdx = new Set();
  const recipes = [];
  for (const { relPath, abs } of files) {
    const raw = parseYaml(readFileSync(abs, "utf8"), relPath);
    validateRecipe(raw, relPath);
    // Seed uniqueness only applies to procedural recipes (explicit
    // recipes don't have a seed).
    if (raw.seed !== undefined) {
      if (seenSeeds.has(raw.seed)) {
        throw new Error(`${relPath}: seed ${raw.seed} already used by an earlier file`);
      }
      seenSeeds.add(raw.seed);
    }
    const packIdx = `${raw.meta.pack}#${raw.meta.indexInPack}`;
    if (seenPackIdx.has(packIdx)) {
      throw new Error(`${relPath}: (pack=${raw.meta.pack}, indexInPack=${raw.meta.indexInPack}) already used by an earlier file`);
    }
    seenPackIdx.add(packIdx);
    recipes.push(raw);
  }
  // Canonical pack order — first-steps tutorial always plays first.
  // Unknown packs sort alphabetically after the known ones so new packs
  // don't silently displace the tutorial.
  const PACK_ORDER = [
    "first-steps", "bend-it", "snakes", "crowd", "mirror",
    "convergence", "spirals", "sparse-zen", "pictograms", "masterpieces",
  ];
  const packRank = (slug) => {
    const i = PACK_ORDER.indexOf(slug);
    return i < 0 ? PACK_ORDER.length + slug.charCodeAt(0) : i;
  };
  recipes.sort((a, b) => {
    const ra = packRank(a.meta.pack), rb = packRank(b.meta.pack);
    if (ra !== rb) return ra - rb;
    return a.meta.indexInPack - b.meta.indexInPack;
  });

  // Enforce contiguous indexInPack per pack (1..N with no gaps). Prevents
  // authors from leaving a hole when moving recipes between packs.
  const perPack = new Map();
  for (const r of recipes) {
    const arr = perPack.get(r.meta.pack) ?? [];
    arr.push(r.meta.indexInPack);
    perPack.set(r.meta.pack, arr);
  }
  for (const [slug, indices] of perPack) {
    const sorted = [...indices].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i + 1) {
        throw new Error(
          `pack '${slug}' indexInPack is not contiguous 1..${sorted.length} — missing ${i + 1} (got sequence ${sorted.join(",")})`,
        );
      }
    }
  }

  const next = emitTs(recipes);

  if (checkOnly) {
    const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (current !== next) {
      console.error("levels-gen --check: levels-data.ts is stale. Run `npm run levels:gen` and commit the result.");
      process.exit(1);
    }
    console.log(`levels-gen --check: ${recipes.length} recipes in sync with ${OUT}`);
    return;
  }

  writeFileSync(OUT, next);
  console.log(`levels-gen: wrote ${recipes.length} recipes → ${OUT}`);
}

// Only invoke CLI when run as a script. Vitest imports this module to
// unit-test parseYaml/validateRecipe; executing main() then would
// crash on the missing levels dir in the test cwd.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { parseYaml, validateRecipe, emitTs, LEVEL_FILENAME, CURRENT_SCHEMA_VERSION };
