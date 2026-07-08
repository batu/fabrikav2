#!/usr/bin/env node
/**
 * adb-playtest-all.mjs — drive the installed APK through the authored levels
 * in sequence, capturing a boot screencap per level and a final summary.
 *
 * Assumes: APK installed, app launched fresh at level 1, device
 * resolution 1080×2400 (Pixel 6a).
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { generatePaths } from "../../src/game/path-generator.js";
import { solve, validateLevel, blockedAtTurn1 } from "../../src/game/solver.js";
import { RECIPES } from "../../src/game/levels-data.js";

const DEVICE_W = 1080;
const DEVICE_H = 2400;
const DPR = 2.625;
const CSS_W = DEVICE_W / DPR;
const CSS_H = DEVICE_H / DPR;

function cellToDevicePx(x, y, cols, rows) {
  const topMargin = CSS_H * 0.16;
  const bottomMargin = CSS_H * 0.08;
  const availableH = CSS_H - topMargin - bottomMargin;
  const availableW = CSS_W * 0.92;
  const cellSize = Math.min(availableW / cols, availableH / rows);
  const gridW = cellSize * cols;
  const gridH = cellSize * rows;
  const originX = (CSS_W - gridW) / 2;
  const originY = topMargin + (availableH - gridH) / 2;
  return { px: Math.round((originX + (x + 0.5) * cellSize) * DPR), py: Math.round((originY + (y + 0.5) * cellSize) * DPR) };
}

function adb(cmd) {
  execSync(`adb ${cmd}`, { stdio: ["ignore", "ignore", "inherit"] });
}
function cap() {
  return execSync(`adb exec-out screencap -p`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function playLevel(levelIdx, r) {
  const dir = "tmp/playtest";
  mkdirSync(dir, { recursive: true });
  const tag = String(levelIdx).padStart(2, "0");

  // Compute tap sequence from deterministic generator + solver.
  let paths = null;
  for (let a = 0; a < 200; a++) {
    try {
      const { paths: p } = generatePaths(r.cols, r.rows, r.arrowCount, r.opts, r.seed + a * 1000003);
      if (!validateLevel(r.cols, r.rows, p)) continue;
      const blocked = blockedAtTurn1(r.cols, r.rows, p);
      if (r.blockedT1 && (blocked < r.blockedT1[0] || blocked > r.blockedT1[1])) continue;
      paths = p;
      break;
    } catch {}
  }
  if (!paths) {
    // Fallback: first solvable (mirrors buildLevel fallback branch).
    for (let a = 0; a < 200; a++) {
      try {
        const { paths: p } = generatePaths(r.cols, r.rows, r.arrowCount, r.opts, r.seed + a * 1000003);
        if (validateLevel(r.cols, r.rows, p)) { paths = p; break; }
      } catch {}
    }
  }
  const order = solve(r.cols, r.rows, paths);
  console.log(`[L${tag}] ${r.meta.title || r.meta.pack}: ${r.cols}×${r.rows}, ${r.arrowCount} arrows, ${order.length}-tap solve`);

  // Snapshot start-of-level.
  writeFileSync(`${dir}/lvl-${tag}-boot.png`, cap());

  for (let i = 0; i < order.length; i++) {
    const { x, y } = order[i];
    const { px, py } = cellToDevicePx(x, y, r.cols, r.rows);
    adb(`shell input tap ${px} ${py}`);
    await sleep(1400);
  }
  // Post-clear screencap (shows "Well done!" word + confetti).
  await sleep(600);
  writeFileSync(`${dir}/lvl-${tag}-cleared.png`, cap());
  // Tap anywhere to dismiss the win overlay → next title card.
  adb(`shell input tap ${Math.round(CSS_W * DPR / 2)} ${Math.round(CSS_H * DPR / 2)}`);
  await sleep(500);
  // Tap again to dismiss next title card (if shown).
  adb(`shell input tap ${Math.round(CSS_W * DPR / 2)} ${Math.round(CSS_H * DPR / 2)}`);
  await sleep(800);
}

async function main() {
  console.log(`Playing all ${RECIPES.length} levels on ${DEVICE_W}×${DEVICE_H}...`);
  for (let i = 0; i < RECIPES.length; i++) {
    await playLevel(i + 1, RECIPES[i]);
  }
  console.log("Done. Screencaps in tmp/playtest/");
}

await main();
