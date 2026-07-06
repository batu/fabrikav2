// Orchestration: load manifest, gather per-state captures for both lanes, run the
// dedup guard, compute diff thumbnails, stamp metadata, assemble the grid HTML.
// The offline path (the AC/verification path) lives here; live capture is wired
// through capture.mjs and gated on a device/harness.

import fs from 'node:fs';
import path from 'node:path';
import { loadManifest } from './manifest.mjs';
import { decodePng } from './png.mjs';
import { signature, digest } from './phash.mjs';
import { assertNoDuplicateStates } from './dedup.mjs';
import { diffThumbnail } from './diff.mjs';

// Load one offline capture for a lane/state, or return a gap cell.
function loadOfflineCell(gameDir, laneDef, lane, stateName, laneMeta) {
  if (!laneDef.offline) {
    return { gap: laneDef.gap || `no ${lane} capture — documented gap`, lane };
  }
  const abs = path.join(gameDir, laneDef.offline);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `offline source for state "${stateName}" ${lane} lane does not exist: ${laneDef.offline}. ` +
      `Manifest must point at committed captures.`
    );
  }
  const buffer = fs.readFileSync(abs);
  const img = decodePng(buffer);
  const sig = signature(img);
  return {
    lane,
    state: stateName,
    gap: null,
    source: laneDef.offline,
    alt: `${stateName} ${lane}`,
    base64: buffer.toString('base64'),
    img,
    signature: sig,
    sig: digest(sig),
    package: laneMeta.package,
    version: laneMeta.version,
    resolution: `${img.width}x${img.height}`,
  };
}

/**
 * Build all grid rows from committed captures (offline mode).
 * @param {object} manifest loaded manifest (with gameDir)
 * @returns {{rows:Array, captures:Array}}
 */
export function buildOfflineRows(manifest) {
  const { gameDir } = manifest;
  const rows = [];
  const captures = []; // for the dedup guard (real captures only, not gaps)

  for (const st of manifest.states) {
    const reference = loadOfflineCell(gameDir, st.reference, 'reference', st.name, manifest.reference);
    const v2 = loadOfflineCell(gameDir, st.v2, 'v2', st.name, manifest.v2);
    if (!reference.gap) captures.push(reference);
    if (!v2.gap) captures.push(v2);

    let diff = null;
    if (!reference.gap && !v2.gap) {
      const d = diffThumbnail(reference.img, v2.img);
      diff = { base64: d.png.toString('base64'), changedFraction: d.changedFraction };
    }
    rows.push({ state: st.name, reference: strip(reference), v2: strip(v2), diff });
  }

  // Structural dedup guard across each lane (fixes B2). Hard error on collision.
  assertNoDuplicateStates(captures);

  return { rows, captures };
}

// Drop heavy fields (img, signature) that the HTML builder doesn't need.
function strip(cell) {
  const { img: _img, signature: _sig, ...rest } = cell;
  return rest;
}

/**
 * @param {string} game
 * @param {string} repoRoot absolute path to monorepo root
 * @returns {object} loaded manifest
 */
export function loadGameManifest(game, repoRoot) {
  const gameDir = path.join(repoRoot, 'games', game);
  if (!fs.existsSync(gameDir)) throw new Error(`game not found: ${gameDir}`);
  return loadManifest(gameDir);
}
