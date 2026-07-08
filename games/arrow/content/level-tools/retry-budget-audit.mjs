#!/usr/bin/env node
/**
 * retry-budget-audit.mjs — measure per-recipe PATH_RETRY_BUDGET pressure
 * against the constraint bands the planned packs (brainstorm doc) impose.
 *
 * For each band, sweep seeds 0..N-1, call generatePaths, count successes
 * and retries-consumed. Output a table so we know whether the shipped
 * PATH_RETRY_BUDGET=200 is generous, tight, or insufficient.
 *
 * Run: node content/level-tools/retry-budget-audit.mjs
 */

import { generatePaths, PATH_RETRY_BUDGET } from "../../src/game/path-generator.js";

const BANDS = [
  // Existing shipped levels
  { name: "L1 intro (easy)", cols: 4, rows: 5, arrowCount: 2, opts: { minLen: 2, maxLen: 3, bendProb: 0.0 } },
  { name: "L10 hardest (current)", cols: 7, rows: 9, arrowCount: 12, opts: { minLen: 2, maxLen: 4, bendProb: 0.3 } },
  // Pack 2 Bend It
  { name: "Pack 2 Bend It mid", cols: 6, rows: 7, arrowCount: 6, opts: { minLen: 2, maxLen: 4, bendProb: 0.6 } },
  // Pack 3 Snakes
  { name: "Pack 3 Snakes mid", cols: 7, rows: 9, arrowCount: 5, opts: { minLen: 5, maxLen: 8, bendProb: 0.4 } },
  { name: "Pack 3 Snakes capstone", cols: 8, rows: 10, arrowCount: 4, opts: { minLen: 6, maxLen: 11, bendProb: 0.5 } },
  // Pack 4 Crowd
  { name: "Pack 4 Crowd capstone", cols: 7, rows: 9, arrowCount: 14, opts: { minLen: 2, maxLen: 3, bendProb: 0.2 } },
  // Pack 7 Spirals
  { name: "Pack 7 Spirals mid", cols: 8, rows: 9, arrowCount: 6, opts: { minLen: 6, maxLen: 9, bendProb: 0.55 } },
  { name: "Pack 7 Spirals capstone", cols: 9, rows: 10, arrowCount: 8, opts: { minLen: 6, maxLen: 10, bendProb: 0.6 } },
  // Pack 8 Sparse Zen
  { name: "Pack 8 Sparse", cols: 10, rows: 12, arrowCount: 6, opts: { minLen: 3, maxLen: 10, bendProb: 0.2 } },
];

const SEEDS_PER_BAND = 200;

function sweep(band) {
  let ok = 0, fail = 0, throws = 0;
  let totalMs = 0;
  for (let seed = 0; seed < SEEDS_PER_BAND; seed++) {
    const t0 = performance.now();
    try {
      generatePaths(band.cols, band.rows, band.arrowCount, band.opts, seed);
      ok++;
    } catch (err) {
      if (/failed to place arrow/.test(String(err?.message))) fail++;
      else throws++;
    }
    totalMs += performance.now() - t0;
  }
  return { ok, fail, throws, msPerSeed: totalMs / SEEDS_PER_BAND };
}

console.log(`PATH_RETRY_BUDGET per arrow = ${PATH_RETRY_BUDGET}`);
console.log(`Sweeping ${SEEDS_PER_BAND} seeds per band.\n`);
console.log(
  [
    "band".padEnd(30),
    "ok".padStart(5),
    "layout-fail".padStart(12),
    "throw".padStart(6),
    "ok%".padStart(6),
    "ms/seed".padStart(9),
  ].join(" "),
);
console.log("-".repeat(72));
for (const band of BANDS) {
  const r = sweep(band);
  const pct = ((r.ok / SEEDS_PER_BAND) * 100).toFixed(1);
  console.log(
    [
      band.name.padEnd(30),
      String(r.ok).padStart(5),
      String(r.fail).padStart(12),
      String(r.throws).padStart(6),
      pct.padStart(6),
      r.msPerSeed.toFixed(2).padStart(9),
    ].join(" "),
  );
}
