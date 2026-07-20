#!/usr/bin/env node
// Analytic max-zoom sharpness audit for find_the_dog levels.
// Score = texels available per device pixel when fully zoomed in (target >= 1.0).
// Deterministic: computed from shipped asset dimensions + runtime caps, no rendering.
//
//   node tools/zoom-sharpness/audit.mjs [--screen-w 1170] [--screen-h 2532] [--max-zoom 2.5]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
// Defaults: iPhone 12/13-class device pixels; caps mirror src/scenes/GameScene.ts
// (MAX_RUNTIME_TEXTURE_LONG_EDGE) and src/scenes/PinchZoom.ts (PINCH.maxZoom).
const SCREEN_W = arg('screen-w', 1170);
const SCREEN_H = arg('screen-h', 2532);
const MAX_ZOOM = arg('max-zoom', 2.5);
const RUNTIME_CAP = arg('runtime-cap', 2560);

const levelsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'games', 'find_the_dog', 'public', 'levels');

function dims(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  const w = Number(/pixelWidth: (\d+)/.exec(out)?.[1]);
  const h = Number(/pixelHeight: (\d+)/.exec(out)?.[1]);
  return { w, h };
}

function score({ w, h }, cap = RUNTIME_CAP) {
  // Runtime cap replicates capTextureLongEdge: long edge clamped to RUNTIME_CAP.
  const ratio = Math.min(1, cap / Math.max(w, h));
  const tw = w * ratio, th = h * ratio;
  // Cover-fit: at zoom 1 the camera fits the level to the screen; scale is the
  // factor mapping texture px -> device px at zoom 1.
  const fit = Math.max(SCREEN_W / tw, SCREEN_H / th);
  // texels per device pixel at max zoom (>1 means oversampled/sharp).
  return 1 / (fit * MAX_ZOOM);
}

const rows = [];
for (const dir of fs.readdirSync(levelsDir)) {
  const webp = path.join(levelsDir, dir, 'color.webp');
  const png = path.join(levelsDir, dir, 'color.png');
  if (!fs.existsSync(webp)) continue;
  const shipped = score(dims(webp));
  // Source potential: what the original PNG could deliver with no runtime cap.
  const source = fs.existsSync(png) ? score(dims(png), Infinity) : null;
  rows.push({ level: dir, shipped, source });
}

rows.sort((a, b) => a.shipped - b.shipped);
console.log(`zoom-sharpness audit — screen ${SCREEN_W}x${SCREEN_H}, maxZoom ${MAX_ZOOM}, runtime cap ${RUNTIME_CAP}`);
console.log('score = texels per device pixel at max zoom (1.00 = pixel-perfect)\n');
for (const r of rows) {
  console.log(`${r.shipped.toFixed(2)}  (source-uncapped ${r.source ? r.source.toFixed(2) : ' n/a'})  ${r.level}`);
}
const med = rows[Math.floor(rows.length / 2)].shipped;
console.log(`\nlevels: ${rows.length} · median shipped score ${med.toFixed(2)} · worst ${rows[0].shipped.toFixed(2)} · best ${rows[rows.length - 1].shipped.toFixed(2)}`);
