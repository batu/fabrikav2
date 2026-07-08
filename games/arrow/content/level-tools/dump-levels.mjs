#!/usr/bin/env node
// Dumps built level paths as JSON, one entry per buildable level.
// Used by content/level-tools/render-packs.py to generate the per-pack overview PNGs.

import { writeFileSync } from "node:fs";
import { generatePaths } from "../../src/game/path-generator.js";
import { blockedAtTurn1, solveBucket, validateLevel } from "../../src/game/solver.js";
import { RECIPES, PACKS } from "../../src/game/levels-data.js";
import { isExplicitRecipe } from "../../src/game/levels-recipe.js";

const RECIPE_RETRIES_DEFAULT = 200;

function applyTransform(cols, rows, cells, transform) {
  return cells.map(([x, y]) => {
    if (transform === "mirror-x") return [cols - 1 - x, y];
    if (transform === "mirror-y") return [x, rows - 1 - y];
    return [cols - 1 - x, rows - 1 - y];
  });
}

function buildExplicit(r) {
  const all = r.arrows.map((cells) => cells.map(([x, y]) => [x, y]));
  if (r.transform) for (const cells of r.arrows) all.push(applyTransform(r.cols, r.rows, cells, r.transform));
  return all;
}

function buildProcedural(r, index) {
  const RETRIES = r.seedSweep ?? RECIPE_RETRIES_DEFAULT;
  const baseMixed = (r.seed ^ ((index * 0x9E3779B1) >>> 0)) >>> 0;
  let fallback = null;
  for (let a = 0; a < RETRIES; a++) {
    const seed = baseMixed + a * 1000003;
    try {
      const { paths } = generatePaths(r.cols, r.rows, r.arrowCount, r.opts, seed);
      if (!validateLevel(r.cols, r.rows, paths)) continue;
      if (r.solverCheck === "unique" || r.solverCheck === "near-unique") {
        const b = solveBucket(r.cols, r.rows, paths);
        if (r.solverCheck === "unique" && b !== "unique") continue;
        if (r.solverCheck === "near-unique" && b !== "unique" && b !== "near-unique") continue;
      }
      const cells = paths.map((p) => p.cells.map((c) => [c.x, c.y]));
      if (!r.blockedT1) return cells;
      const blocked = blockedAtTurn1(r.cols, r.rows, paths);
      if (blocked >= r.blockedT1[0] && blocked <= r.blockedT1[1]) return cells;
      if (!fallback) fallback = cells;
    } catch {}
  }
  return fallback;
}

const out = { packs: [], levels: [] };
for (const p of PACKS) {
  out.packs.push({ slug: p.slug, indices: p.indices, firstTitle: p.firstTitle });
}
for (let i = 0; i < RECIPES.length; i++) {
  const r = RECIPES[i];
  const arrows = isExplicitRecipe(r) ? buildExplicit(r) : buildProcedural(r, i + 1);
  out.levels.push({
    index: i + 1,
    cols: r.cols,
    rows: r.rows,
    pack: r.meta.pack,
    indexInPack: r.meta.indexInPack,
    title: r.meta.title ?? "",
    difficulty: r.meta.difficulty ?? "",
    arrows: arrows ?? [],
    buildable: arrows !== null && arrows !== undefined,
  });
}

writeFileSync("tmp/packs-dump.json", JSON.stringify(out, null, 2));
console.log(`dumped ${out.levels.length} levels, ${out.packs.length} packs → tmp/packs-dump.json`);
console.log(`buildable: ${out.levels.filter((l) => l.buildable).length}/${out.levels.length}`);
