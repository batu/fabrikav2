#!/usr/bin/env node
/**
 * adb-playtest.mjs — drive the installed APK through a level via adb.
 *
 * Usage:
 *   node content/level-tools/adb-playtest.mjs <level-index>
 *
 * For the given level: runs the generator + solver, converts each tap
 * coord to device pixels via the viewport geometry formula used by
 * render.ts, sends `adb shell input tap` for each tap with a small
 * delay. Screencaps after each tap into tmp/playtest/lvl-NN-step-MM.png.
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { generatePaths } from "../../src/game/path-generator.js";
import { solve, validateLevel, blockedAtTurn1 } from "../../src/game/solver.js";
import { RECIPES } from "../../src/game/levels-data.js";

// Pixel 6a (27091JEGR22183): 1080×2400 screen, 420 dpi → CSS px 2.625×
const DEVICE_W = 1080;
const DEVICE_H = 2400;
const DPR = 2.625;
const CSS_W = DEVICE_W / DPR;
const CSS_H = DEVICE_H / DPR;

// Viewport math mirrors render.ts computeViewport:
//   Grid is centered horizontally in cssW.
//   Vertical placement: small top padding (for HUD), cell size chosen
//   to fit both dimensions. Approximate with 8% top margin, 12% bottom
//   margin. If offsets are off by a few px, the tap-target is the full
//   cell body so small drift is forgiven.
function cellToDevicePx(x, y, cols, rows) {
  const topMargin = CSS_H * 0.16; // hearts + gear
  const bottomMargin = CSS_H * 0.08;
  const availableH = CSS_H - topMargin - bottomMargin;
  const availableW = CSS_W * 0.92;
  const cellSize = Math.min(availableW / cols, availableH / rows);
  const gridW = cellSize * cols;
  const gridH = cellSize * rows;
  const originX = (CSS_W - gridW) / 2;
  const originY = topMargin + (availableH - gridH) / 2;
  const cssX = originX + (x + 0.5) * cellSize;
  const cssY = originY + (y + 0.5) * cellSize;
  return { px: Math.round(cssX * DPR), py: Math.round(cssY * DPR) };
}

function adb(cmd) {
  return execSync(`adb ${cmd}`, { stdio: ["ignore", "pipe", "inherit"] }).toString();
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function playLevel(levelIdx) {
  const r = RECIPES[levelIdx - 1];
  if (!r) throw new Error(`no recipe at index ${levelIdx}`);
  console.log(`Level ${levelIdx} (${r.meta.title}): ${r.cols}×${r.rows}, ${r.arrowCount} arrows, seed ${r.seed}`);

  // Find a seed that actually solves (mirrors levels.ts buildLevel).
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
  if (!paths) throw new Error(`couldn't generate level ${levelIdx}`);
  const order = solve(r.cols, r.rows, paths);
  if (!order) throw new Error(`unsolvable`);
  console.log(`  tap sequence: ${order.map((c) => `(${c.x},${c.y})`).join(" → ")}`);

  mkdirSync("tmp/playtest", { recursive: true });

  // Wait 1s after launch, screencap.
  await sleep(1000);
  const boot = execSync(`adb exec-out screencap -p`);
  writeFileSync(`tmp/playtest/lvl-${String(levelIdx).padStart(2, "0")}-boot.png`, boot);

  for (let i = 0; i < order.length; i++) {
    const { x, y } = order[i];
    const { px, py } = cellToDevicePx(x, y, r.cols, r.rows);
    console.log(`  tap ${i + 1}/${order.length}: cell (${x},${y}) → device (${px},${py})`);
    adb(`shell input tap ${px} ${py}`);
    await sleep(1400); // wait for slither anim to complete
    const cap = execSync(`adb exec-out screencap -p`);
    writeFileSync(`tmp/playtest/lvl-${String(levelIdx).padStart(2, "0")}-step-${String(i + 1).padStart(2, "0")}.png`, cap);
  }

  await sleep(800);
  const done = execSync(`adb exec-out screencap -p`);
  writeFileSync(`tmp/playtest/lvl-${String(levelIdx).padStart(2, "0")}-done.png`, done);
  console.log(`  ✓ level ${levelIdx} captured`);
}

const levelArg = Number(process.argv[2]);
if (!levelArg) {
  console.error("usage: node content/level-tools/adb-playtest.mjs <level-index>");
  process.exit(1);
}
await playLevel(levelArg);
