// Resolution-independent image sampling. Reference (1080x2400) and v2 (390x844,
// 780x1688) captures differ in size and aspect, so every comparison downsamples
// both sides to a common small grid first — that is what lets us pair captures
// perceptually rather than pixel-for-pixel.

/** Rec. 601 luma from RGB. */
function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Box-downsample an RGBA image to a wxh grayscale grid.
 * @param {{width:number,height:number,data:Uint8Array}} img
 * @param {number} w target width
 * @param {number} h target height
 * @returns {Float64Array} length w*h, values 0..255
 */
export function grayGrid(img, w, h) {
  const out = new Float64Array(w * h);
  for (let gy = 0; gy < h; gy++) {
    const y0 = Math.floor((gy * img.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * img.height) / h));
    for (let gx = 0; gx < w; gx++) {
      const x0 = Math.floor((gx * img.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * img.width) / w));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * img.width + x) * 4;
          sum += luma(img.data[p], img.data[p + 1], img.data[p + 2]);
          count++;
        }
      }
      out[gy * w + gx] = count ? sum / count : 0;
    }
  }
  return out;
}
