// Perceptual signature for the dedup guard (ledger B2). A 32x32 downscaled
// grayscale fingerprint; distance is mean-absolute-difference (0..255),
// resolution independent.
//
// Why MAD over a 32x32 signature and not a dHash: calibrated against the
// committed reference captures (test/phash.test.js), a coarse dHash could not
// separate the classes — the true-duplicate pair level-start/level-mid was
// FARTHER apart (Hamming 11) than a genuinely-distinct pair win/fail (Hamming 8).
// The 32x32 MAD is unambiguous: level-start/level-mid ~0.9, while the closest
// distinct pair (win/fail) is ~21 — so DUP_THRESHOLD sits in a wide, safe gap.

import { grayGrid } from './image.mjs';

const SIG = 32;

// Dup if MAD <= this. Chosen from the calibration gap: true dup ~0.9, nearest
// distinct ~21. 10 is comfortably between and far from either boundary.
export const DUP_THRESHOLD = 10;

/**
 * @param {{width:number,height:number,data:Uint8Array}} img
 * @returns {Uint8Array} 32*32 grayscale fingerprint (0..255)
 */
export function signature(img) {
  const g = grayGrid(img, SIG, SIG);
  const out = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = Math.round(g[i]);
  return out;
}

/** Mean absolute difference between two signatures (0..255). */
export function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** Short stable hex digest of a signature, for metadata display (FNV-1a 32-bit). */
export function digest(sig) {
  let h = 0x811c9dc5;
  for (let i = 0; i < sig.length; i++) {
    h ^= sig[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
