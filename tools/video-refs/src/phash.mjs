// Adapted from tools/refcap-compare/src/phash.mjs: the same 32x32 grayscale
// signature and mean-absolute-difference duplicate threshold. This tool uses
// ffmpeg to decode arbitrary video frames to raw grayscale bytes instead of
// refcap-compare's in-tree PNG decoder, because suggest operates on video/JPEG.

export const SIG = 32;
export const DUP_THRESHOLD = 10;

export function signature(rawGray) {
  if (!(rawGray instanceof Uint8Array) || rawGray.length !== SIG * SIG) {
    throw new Error(`phash signature expects ${SIG * SIG} grayscale bytes`);
  }
  return Uint8Array.from(rawGray);
}

export function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

export function isDuplicate(a, b) {
  return distance(a, b) <= DUP_THRESHOLD;
}
