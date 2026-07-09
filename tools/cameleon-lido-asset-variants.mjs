import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './refcap-compare/src/png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..', 'games', 'cameleon');
const SPRITES_DIR = join(GAME_ROOT, 'public', 'levels', 'lido', 'sprites');
const MANIFEST_PATH = join(GAME_ROOT, 'design', 'asset-identity.json');
const SCRIPT_REL = 'tools/cameleon-lido-asset-variants.mjs';
const ART_DATE = '2026-07-08';
const DESIGN_REFS = ['docs/DESIGN.md#4-hide-roster', 'docs/DESIGN.md#9-art-generation-plan'];

const ORGANIC_HIDE_IDS = ['li-01', 'li-03', 'li-04', 'li-05', 'li-09'];
const PALETTES = {
  gouache: {
    shadow: [22, 80, 92],
    mid: [255, 95, 126],
    light: [255, 241, 202],
  },
  roughrender: {
    shadow: [13, 34, 60],
    mid: [111, 176, 189],
    light: [246, 243, 232],
  },
};

function relGame(path) {
  return relative(GAME_ROOT, path).split('/').join('/');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function luminance(data, index) {
  return (0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]) / 255;
}

function repaintOrganic(screenprint, white, palette) {
  if (screenprint.width !== white.width || screenprint.height !== white.height) {
    throw new Error(`dimension mismatch: ${screenprint.width}x${screenprint.height} vs ${white.width}x${white.height}`);
  }
  const out = new Uint8Array(screenprint.data.length);
  for (let index = 0; index < out.length; index += 4) {
    const alpha = white.data[index + 3];
    if (alpha === 0) {
      out[index + 3] = 0;
      continue;
    }
    const lum = luminance(screenprint.data, index);
    const base = lum < 0.58
      ? mix(palette.shadow, palette.mid, lum / 0.58)
      : mix(palette.mid, palette.light, (lum - 0.58) / 0.42);
    out[index] = base[0];
    out[index + 1] = base[1];
    out[index + 2] = base[2];
    out[index + 3] = alpha;
  }
  return encodePng(screenprint.width, screenprint.height, out);
}

function readPng(path) {
  return decodePng(readFileSync(path));
}

function writeManifest(entries) {
  const existing = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    : {};
  const assets = { ...(existing.assets ?? {}) };
  const derived = [];

  for (const entry of entries) {
    assets[entry.outputRel] = {
      source: entry.screenprintRel,
      expectation: 'derived-alpha-lock',
      reason: 'Deterministic local recolor from accepted Poster Pop organic sprite; alpha copied from the accepted white reveal.',
      provenance: {
        authored: false,
        generated: false,
        model: 'derived',
        date: ART_DATE,
        cost_estimate_usd: 0.0,
        card: 'cHf5RquT',
        script: SCRIPT_REL,
        kind: 'hide-painted-derived',
        palette: entry.palette,
        sourcePainted: entry.screenprintRel,
        sourceAlpha: entry.whiteRel,
        dimensions: { width: entry.width, height: entry.height },
        bytes: entry.bytes,
        sha256: entry.sha256,
        designRefs: DESIGN_REFS,
      },
    };
    derived.push({
      path: entry.outputRel,
      generated: false,
      model: 'derived',
      date: ART_DATE,
      cost_estimate_usd: 0.0,
      spec: `${entry.hideId} ${entry.palette} local recolor; alpha copied from white reveal`,
      source: entry.screenprintRel,
      alpha_source: entry.whiteRel,
      provenance: SCRIPT_REL,
    });
  }

  const manifest = {
    ...existing,
    version: 1,
    coverage: 'complete',
    assets,
    'derived-lido-art-v1': [
      ...(existing['derived-lido-art-v1'] ?? []).filter((entry) =>
        !derived.some((next) => next.path === entry.path)
      ),
      ...derived,
    ],
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

function main() {
  const entries = [];
  for (const hideId of ORGANIC_HIDE_IDS) {
    const screenprintPath = join(SPRITES_DIR, 'screenprint', `${hideId}-painted-organic.png`);
    const whitePath = join(SPRITES_DIR, 'white', `${hideId}-white-organic.png`);
    const screenprint = readPng(screenprintPath);
    const white = readPng(whitePath);
    for (const [paletteName, palette] of Object.entries(PALETTES)) {
      const outputPath = join(SPRITES_DIR, paletteName, `${hideId}-painted-organic.png`);
      mkdirSync(dirname(outputPath), { recursive: true });
      const png = repaintOrganic(screenprint, white, palette);
      writeFileSync(outputPath, png);
      entries.push({
        hideId,
        palette: paletteName,
        outputRel: relGame(outputPath),
        screenprintRel: relGame(screenprintPath),
        whiteRel: relGame(whitePath),
        width: screenprint.width,
        height: screenprint.height,
        bytes: png.length,
        sha256: sha256(png),
      });
    }
  }
  writeManifest(entries);
  console.log(`lido variants: rendered ${entries.length} derived organic sprites`);
  console.log(`manifest: ${relGame(MANIFEST_PATH)}`);
}

main();
