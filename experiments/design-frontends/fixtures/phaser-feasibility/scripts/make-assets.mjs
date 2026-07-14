// Deterministic generator for the fixture's probe rasters. The PNGs it emits
// are committed; this script is their provenance (authored here, CC0-clean,
// no external asset source). Re-running must reproduce byte-identical files.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "editor-project", "public", "assets");

function crc32Simple(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32Simple(body));
  return Buffer.concat([len, body, crc]);
}

// size x size RGBA PNG from a per-pixel color function.
function png(size, colorAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = colorAt(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const S = 64;
const inBadge = (x, y) => {
  const d = Math.hypot(x - 31.5, y - 31.5);
  return d < 28;
};

const files = {
  "badge-blue.png": png(S, (x, y) =>
    inBadge(x, y) ? [40, 90, 220, 255] : [0, 0, 0, 0]
  ),
  "badge-amber.png": png(S, (x, y) =>
    inBadge(x, y) ? [230, 160, 30, 255] : [0, 0, 0, 0]
  ),
  "button-play.png": png(S, (x, y) => {
    const border = x < 3 || y < 3 || x > S - 4 || y > S - 4;
    if (border) return [255, 255, 255, 255];
    const inTriangle = x > 20 && x < 48 && Math.abs(y - 32) < (x - 20) * 0.5;
    return inTriangle ? [255, 255, 255, 255] : [30, 160, 80, 255];
  }),
};

mkdirSync(outDir, { recursive: true });
for (const [name, buf] of Object.entries(files)) {
  writeFileSync(join(outDir, name), buf);
  console.log(`wrote ${name} (${buf.length} bytes)`);
}
