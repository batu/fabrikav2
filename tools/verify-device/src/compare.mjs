// Build the device|reference|diff rows for the grid + verdict.
//
// Reuses tools/refcap-compare primitives (zero-dep PNG codec + perceptual
// pixel-diff) rather than re-implementing them — the card's "reuse refcap-compare"
// constraint. The reference lane is the SAME committed set refcap-compare uses
// (games/<g>/refs/ via the manifest), so a device capture is diffed against the
// exact authoritative reference, not a re-derived one.

import fs from 'node:fs';
import path from 'node:path';
import { decodePng } from '../../refcap-compare/src/png.mjs';
import { signature, digest } from '../../refcap-compare/src/phash.mjs';
import { diffThumbnail } from '../../refcap-compare/src/diff.mjs';

function deviceCell(state, absPath) {
  if (!absPath || !fs.existsSync(absPath)) {
    return { gap: `no device capture for "${state}" — state missing from the tour`, lane: 'device' };
  }
  const buffer = fs.readFileSync(absPath);
  const img = decodePng(buffer);
  return {
    lane: 'device',
    state,
    gap: null,
    source: absPath,
    alt: `${state} device`,
    base64: buffer.toString('base64'),
    img,
    resolution: `${img.width}x${img.height}`,
    sig: digest(signature(img)),
  };
}

function referenceCell(gameDir, state, laneDef, refMeta) {
  if (!laneDef || (!laneDef.offline && laneDef.gap)) {
    return { gap: (laneDef && laneDef.gap) || `no reference for "${state}"`, lane: 'reference' };
  }
  const abs = path.join(gameDir, laneDef.offline);
  if (!fs.existsSync(abs)) {
    return { gap: `reference source missing on disk: ${laneDef.offline}`, lane: 'reference' };
  }
  const buffer = fs.readFileSync(abs);
  const img = decodePng(buffer);
  return {
    lane: 'reference',
    state,
    gap: null,
    source: laneDef.offline,
    alt: `${state} reference`,
    base64: buffer.toString('base64'),
    img,
    package: refMeta && refMeta.package,
    version: refMeta && refMeta.version,
    resolution: `${img.width}x${img.height}`,
    sig: digest(signature(img)),
  };
}

/**
 * @param {object} params
 * @param {object} params.manifest loaded refcap-compare manifest (with gameDir)
 * @param {Record<string,string>} params.deviceCaptures state -> abs PNG path
 * @returns {{rows: Array}} one row per canonical state
 */
export function buildRows({ manifest, deviceCaptures }) {
  const { gameDir } = manifest;
  const rows = [];
  for (const st of manifest.states) {
    const device = deviceCell(st.name, deviceCaptures[st.name]);
    const reference = referenceCell(gameDir, st.name, st.reference, manifest.reference);
    let diff = null;
    if (!device.gap && !reference.gap) {
      const d = diffThumbnail(reference.img, device.img);
      diff = { base64: d.png.toString('base64'), changedFraction: d.changedFraction, meanDelta: d.meanDelta };
    }
    rows.push({ state: st.name, device: strip(device), reference: strip(reference), diff });
  }
  return { rows };
}

// Drop the decoded image (grid/verdict don't need the raw pixels).
function strip(cell) {
  const { img: _img, ...rest } = cell;
  return rest;
}
