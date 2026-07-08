#!/usr/bin/env node
/**
 * level-new.mjs — scaffold a new yaml recipe file.
 *
 * Usage:
 *   node content/level-tools/level-new.mjs <pack-slug> <level-slug>
 *
 * Determines the next indexInPack for <pack-slug> by reading the
 * existing subdir, picks a seed that doesn't collide with any existing
 * recipe, writes `levels/<pack>/NN-<slug>.yaml` with schema comments.
 *
 * After running: edit the file, then `npm run levels:gen`.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const LEVELS_DIR = join(HERE, "..", "levels");

function usedSeeds() {
  const seeds = new Set();
  for (const entry of readdirSync(LEVELS_DIR)) {
    const abs = join(LEVELS_DIR, entry);
    const st = statSync(abs);
    const files = st.isDirectory() ? readdirSync(abs).map((f) => join(abs, f)) : [abs];
    for (const f of files) {
      if (!f.endsWith(".yaml")) continue;
      const src = readFileSync(f, "utf8");
      const m = src.match(/^seed:\s*(\d+)/m);
      if (m) seeds.add(Number(m[1]));
    }
  }
  return seeds;
}

function nextIndexInPack(packSlug) {
  const dir = join(LEVELS_DIR, packSlug);
  if (!existsSync(dir)) return 1;
  const indices = readdirSync(dir)
    .filter((f) => /^\d{2}-/.test(f))
    .map((f) => Number(f.slice(0, 2)));
  return (indices.length > 0 ? Math.max(...indices) : 0) + 1;
}

function pickSeed(used) {
  // Preferred: pack_prefix * 1000 + idx pattern seeds (101, 202, ...).
  // Fallback: incrementing by 37 until unused.
  let s = 1000 + Math.floor(Math.random() * 100000);
  while (used.has(s)) s += 37;
  return s;
}

function main() {
  const [packSlug, levelSlug] = process.argv.slice(2);
  if (!packSlug || !levelSlug) {
    console.error("usage: node content/level-tools/level-new.mjs <pack-slug> <level-slug>");
    process.exit(2);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(packSlug)) {
    console.error(`pack slug '${packSlug}' must be kebab-case`);
    process.exit(2);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(levelSlug)) {
    console.error(`level slug '${levelSlug}' must be kebab-case`);
    process.exit(2);
  }

  const idx = nextIndexInPack(packSlug);
  if (idx > 99) {
    console.error(`pack '${packSlug}' is already at 99 levels`);
    process.exit(1);
  }
  const seed = pickSeed(usedSeeds());
  const paddedIdx = String(idx).padStart(2, "0");
  const packDir = join(LEVELS_DIR, packSlug);
  mkdirSync(packDir, { recursive: true });
  const filePath = join(packDir, `${paddedIdx}-${levelSlug}.yaml`);

  if (existsSync(filePath)) {
    console.error(`${filePath}: already exists`);
    process.exit(1);
  }

  const yaml = `# Level ${idx} of pack "${packSlug}".
# Edit the numbers below and run \`npm run levels:gen\`.
cols: 5
rows: 7
arrowCount: 3
opts:
  minLen: 2
  maxLen: 4
  bendProb: 0.25
seed: ${seed}
# Optional: uncomment to constrain difficulty band.
# blockedT1: [0, 1]
meta:
  pack: ${packSlug}
  indexInPack: ${idx}
  title: ${levelSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
  difficulty: easy
`;
  writeFileSync(filePath, yaml);
  console.log(`wrote ${filePath} (seed=${seed}, indexInPack=${idx})`);
  console.log(`next: edit the file, then \`npm run levels:gen\``);
}

main();
