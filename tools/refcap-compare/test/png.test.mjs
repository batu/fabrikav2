import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../src/png.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MENU = path.join(REPO, 'games/marble_run/refs/captures/android-basegamelab/menu.png');

describe('png codec (zero-dep via node:zlib)', () => {
  it('decodes a committed RGBA reference capture to the right dimensions', () => {
    const img = decodePng(fs.readFileSync(MENU));
    expect(img.width).toBe(1080);
    expect(img.height).toBe(2400);
    expect(img.data.length).toBe(1080 * 2400 * 4);
  });

  it('round-trips encode -> decode preserving pixels', () => {
    const w = 5;
    const h = 4;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) & 0xff;
    // force full alpha so decode (which fills 255 for RGB) still matches encode
    for (let p = 3; p < rgba.length; p += 4) rgba[p] = 255;
    const png = encodePng(w, h, rgba);
    const back = decodePng(png);
    expect(back.width).toBe(w);
    expect(back.height).toBe(h);
    expect(Array.from(back.data)).toEqual(Array.from(rgba));
  });
});
