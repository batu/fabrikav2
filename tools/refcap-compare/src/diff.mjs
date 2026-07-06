// Perceptual pixel-diff thumbnail. Reference and v2 captures have different
// resolutions/aspect ratios, so both are downsampled to a common grid and the
// per-cell luma delta is rendered as a heat thumbnail (dark = same, hot magenta
// = different). Returns the thumbnail as a PNG plus a scalar "how different"
// fraction for the grid caption.

import { grayGrid } from './image.mjs';
import { encodePng } from './png.mjs';

const DIFF_W = 90;
const DIFF_H = 200; // ~portrait phone aspect

/**
 * @param {{width:number,height:number,data:Uint8Array}} a
 * @param {{width:number,height:number,data:Uint8Array}} b
 * @returns {{png:Buffer, changedFraction:number, meanDelta:number}}
 */
export function diffThumbnail(a, b) {
  const ga = grayGrid(a, DIFF_W, DIFF_H);
  const gb = grayGrid(b, DIFF_W, DIFF_H);
  const rgba = new Uint8Array(DIFF_W * DIFF_H * 4);
  let changed = 0;
  let deltaSum = 0;
  for (let i = 0; i < ga.length; i++) {
    const delta = Math.abs(ga[i] - gb[i]); // 0..255
    deltaSum += delta;
    if (delta > 24) changed++;
    // heat: 0 -> near-black, high -> magenta
    const t = Math.min(1, delta / 128);
    const p = i * 4;
    rgba[p] = Math.round(20 + t * 235); // R
    rgba[p + 1] = Math.round(20 * (1 - t)); // G
    rgba[p + 2] = Math.round(20 + t * 200); // B
    rgba[p + 3] = 255;
  }
  return {
    png: encodePng(DIFF_W, DIFF_H, rgba),
    changedFraction: changed / ga.length,
    meanDelta: deltaSum / ga.length,
  };
}
