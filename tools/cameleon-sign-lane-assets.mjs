import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './refcap-compare/src/png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..', 'games', 'cameleon');
const SPRITES_DIR = join(GAME_ROOT, 'public', 'levels', 'lido', 'sprites');
const WORK_DIR = join(GAME_ROOT, '.work');
const MANIFEST_PATH = join(GAME_ROOT, 'design', 'asset-identity.json');
const SCRIPT_REL = 'tools/cameleon-sign-lane-assets.mjs';
const DESIGN_REFS = ['docs/DESIGN.md#4-hide-roster', 'docs/DESIGN.md#9-art-generation-plan'];
const SAMPLE_OFFSETS = [0.25, 0.75];

const PALETTES = {
  poster: {
    paper: '#fff3c4',
    panel: '#ffd85a',
    panelDark: '#e6aa36',
    ink: '#103943',
    inkSoft: '#2f6471',
    red: '#df4540',
    aqua: '#47c2cf',
    teal: '#0b5965',
    cream: '#fff9df',
    shadow: '#44606b',
    whiteBody: '#f9f7ea',
    whiteShade: '#d8d4c7',
  },
  riso: {
    paper: '#f7e3bd',
    panel: '#f7c84f',
    panelDark: '#d49a2d',
    ink: '#166a73',
    inkSoft: '#1d8991',
    red: '#ff5f55',
    aqua: '#42bfc1',
    teal: '#12636d',
    cream: '#fff1ca',
    shadow: '#476269',
    whiteBody: '#fff1da',
    whiteShade: '#dfcdb8',
  },
  night: {
    paper: '#182544',
    panel: '#f0bc4f',
    panelDark: '#a97331',
    ink: '#d5f7ef',
    inkSoft: '#7ad0cf',
    red: '#ff665e',
    aqua: '#49e3e0',
    teal: '#1d7587',
    cream: '#ffe6a1',
    shadow: '#07111f',
    whiteBody: '#f6f3e8',
    whiteShade: '#9bb7bd',
  },
};

const FONT = {
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
  '!': ['1', '1', '1', '1', '1', '0', '1'],
  '.': ['0', '0', '0', '0', '0', '0', '1'],
  '-': ['000', '000', '000', '111', '000', '000', '000'],
  '/': ['00001', '00010', '00100', '01000', '10000', '00000', '00000'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '11100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
};

function rect(x, y, w, h, fill, opts = {}) {
  return { type: 'rect', x, y, w, h, fill, rx: opts.rx ?? 0, opacity: opts.opacity ?? 1 };
}

function circle(cx, cy, r, fill, opts = {}) {
  return { type: 'circle', cx, cy, r, fill, opacity: opts.opacity ?? 1 };
}

function ellipse(cx, cy, rx, ry, fill, opts = {}) {
  return { type: 'ellipse', cx, cy, rx, ry, fill, opacity: opts.opacity ?? 1 };
}

function poly(points, fill, opts = {}) {
  return { type: 'poly', points, fill, opacity: opts.opacity ?? 1 };
}

function line(x1, y1, x2, y2, width, fill, opts = {}) {
  return { type: 'line', x1, y1, x2, y2, width, fill, opacity: opts.opacity ?? 1 };
}

function textWidth(text, size, tracking = 1) {
  const scale = size / 7;
  let width = 0;
  for (const char of text.toUpperCase()) {
    const rows = FONT[char] ?? FONT[' '];
    width += rows[0].length * scale + tracking * scale;
  }
  return Math.max(0, width - tracking * scale);
}

function addText(shapes, text, x, y, size, fill, opts = {}) {
  const scale = size / 7;
  const tracking = opts.tracking ?? 1;
  const align = opts.align ?? 'left';
  const width = textWidth(text, size, tracking);
  let cursor = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;

  for (const char of text.toUpperCase()) {
    const rows = FONT[char] ?? FONT[' '];
    for (let row = 0; row < rows.length; row += 1) {
      for (let col = 0; col < rows[row].length; col += 1) {
        if (rows[row][col] === '1') {
          shapes.push(rect(cursor + col * scale, y + row * scale, scale, scale, fill, { opacity: opts.opacity }));
        }
      }
    }
    cursor += rows[0].length * scale + tracking * scale;
  }
}

function panel(shapes, x, y, w, h, palette, title) {
  shapes.push(rect(x, y, w, h, palette.panelDark, { rx: 12 }));
  shapes.push(rect(x + 8, y + 8, w - 16, h - 16, palette.panel, { rx: 8 }));
  shapes.push(rect(x + 20, y + 20, w - 40, 36, palette.paper, { rx: 6, opacity: 0.88 }));
  addText(shapes, title, x + w / 2, y + 29, 18, palette.ink, { align: 'center' });
}

function drawStandingPerson(shapes, x, y, scale, fill) {
  shapes.push(circle(x, y, 9 * scale, fill));
  shapes.push(line(x, y + 11 * scale, x, y + 48 * scale, 16 * scale, fill));
  shapes.push(line(x - 4 * scale, y + 23 * scale, x - 24 * scale, y + 42 * scale, 8 * scale, fill));
  shapes.push(line(x + 4 * scale, y + 23 * scale, x + 24 * scale, y + 42 * scale, 8 * scale, fill));
  shapes.push(line(x - 4 * scale, y + 50 * scale, x - 16 * scale, y + 78 * scale, 9 * scale, fill));
  shapes.push(line(x + 4 * scale, y + 50 * scale, x + 16 * scale, y + 78 * scale, 9 * scale, fill));
}

function drawWalkingPerson(shapes, x, y, scale, fill) {
  shapes.push(circle(x, y, 8 * scale, fill));
  shapes.push(line(x, y + 10 * scale, x + 12 * scale, y + 40 * scale, 14 * scale, fill));
  shapes.push(line(x + 5 * scale, y + 23 * scale, x - 18 * scale, y + 32 * scale, 7 * scale, fill));
  shapes.push(line(x + 10 * scale, y + 25 * scale, x + 30 * scale, y + 12 * scale, 7 * scale, fill));
  shapes.push(line(x + 12 * scale, y + 42 * scale, x - 9 * scale, y + 68 * scale, 8 * scale, fill));
  shapes.push(line(x + 13 * scale, y + 43 * scale, x + 35 * scale, y + 64 * scale, 8 * scale, fill));
}

function drawSlippingPerson(shapes, x, y, scale, fill, shadowFill) {
  shapes.push(ellipse(x + 30 * scale, y + 84 * scale, 56 * scale, 9 * scale, shadowFill, { opacity: 0.38 }));
  shapes.push(circle(x + 10 * scale, y + 8 * scale, 8 * scale, fill));
  shapes.push(line(x + 8 * scale, y + 19 * scale, x + 43 * scale, y + 46 * scale, 14 * scale, fill));
  shapes.push(line(x + 20 * scale, y + 25 * scale, x - 14 * scale, y + 18 * scale, 7 * scale, fill));
  shapes.push(line(x + 30 * scale, y + 35 * scale, x + 10 * scale, y + 60 * scale, 7 * scale, fill));
  shapes.push(line(x + 42 * scale, y + 49 * scale, x + 78 * scale, y + 38 * scale, 8 * scale, fill));
  shapes.push(line(x + 41 * scale, y + 51 * scale, x + 62 * scale, y + 78 * scale, 8 * scale, fill));
}

function drawMascot(shapes, x, y, scale, fill, shade) {
  shapes.push(circle(x, y, 10 * scale, fill));
  shapes.push(ellipse(x, y + 26 * scale, 15 * scale, 21 * scale, fill));
  shapes.push(ellipse(x - 8 * scale, y + 11 * scale, 11 * scale, 10 * scale, shade, { opacity: 0.35 }));
  shapes.push(line(x - 14 * scale, y + 22 * scale, x - 38 * scale, y - 8 * scale, 9 * scale, fill));
  shapes.push(line(x + 14 * scale, y + 22 * scale, x + 38 * scale, y - 8 * scale, 9 * scale, fill));
  shapes.push(circle(x - 40 * scale, y - 10 * scale, 6 * scale, fill));
  shapes.push(circle(x + 40 * scale, y - 10 * scale, 6 * scale, fill));
  shapes.push(line(x - 8 * scale, y + 46 * scale, x - 19 * scale, y + 68 * scale, 8 * scale, fill));
  shapes.push(line(x + 8 * scale, y + 46 * scale, x + 19 * scale, y + 68 * scale, 8 * scale, fill));
}

function decoyRulesBoard(palette) {
  const shapes = [];
  panel(shapes, 10, 10, 400, 280, palette, 'POOL RULES');
  const cards = [
    ['SHOWER', 70, 100],
    ['WALK', 220, 100],
    ['NO GLASS', 70, 200],
    ['DEPTH', 220, 200],
  ];
  for (const [label, x, y] of cards) {
    shapes.push(rect(x - 48, y - 42, 96, 72, palette.paper, { rx: 8, opacity: 0.86 }));
    addText(shapes, label, x, y + 38, 12, palette.ink, { align: 'center' });
  }
  drawStandingPerson(shapes, 70, 68, 0.72, palette.ink);
  shapes.push(line(59, 100, 82, 85, 6, palette.aqua));
  drawWalkingPerson(shapes, 216, 64, 0.68, palette.ink);
  shapes.push(rect(48, 170, 32, 38, palette.ink, { rx: 4 }));
  shapes.push(line(36, 159, 102, 217, 9, palette.red));
  shapes.push(circle(70, 190, 42, palette.red, { opacity: 0.18 }));
  addText(shapes, '1.2M', 220, 178, 24, palette.ink, { align: 'center' });
  shapes.push(rect(178, 205, 84, 9, palette.teal, { rx: 4 }));
  return asset('decoy-rules-board', 420, 300, shapes, 'Rules board pictogram decoy');
}

function decoyNoRunning(palette) {
  const shapes = [];
  shapes.push(rect(20, 20, 216, 216, palette.paper, { rx: 18 }));
  shapes.push(circle(128, 128, 92, palette.red));
  shapes.push(circle(128, 128, 72, palette.paper));
  drawWalkingPerson(shapes, 110, 82, 1.15, palette.ink);
  shapes.push(line(68, 188, 190, 66, 17, palette.red));
  addText(shapes, 'NO RUNNING', 128, 224, 13, palette.ink, { align: 'center' });
  return asset('decoy-no-running-sign', 256, 256, shapes, 'No-running sign decoy');
}

function decoyDepthMarkers(palette) {
  const shapes = [];
  shapes.push(rect(12, 20, 376, 140, palette.teal, { rx: 8 }));
  shapes.push(rect(24, 32, 108, 116, palette.paper, { rx: 6 }));
  shapes.push(rect(146, 32, 108, 116, palette.paper, { rx: 6 }));
  shapes.push(rect(268, 32, 108, 116, palette.paper, { rx: 6 }));
  addText(shapes, '0.8M', 78, 70, 28, palette.ink, { align: 'center' });
  addText(shapes, '1.2M', 200, 70, 28, palette.ink, { align: 'center' });
  addText(shapes, '2.4M', 322, 70, 28, palette.ink, { align: 'center' });
  addText(shapes, 'DEPTH', 200, 126, 16, palette.cream, { align: 'center' });
  return asset('decoy-depth-markers', 400, 180, shapes, 'Pool depth marker decoys');
}

function decoyWetFloor(palette) {
  const shapes = [];
  shapes.push(poly([[46, 268], [120, 28], [194, 268]], palette.panelDark));
  shapes.push(poly([[62, 252], [120, 62], [178, 252]], palette.panel));
  shapes.push(rect(52, 252, 136, 16, palette.panelDark, { rx: 6 }));
  drawSlippingPerson(shapes, 76, 105, 0.82, palette.ink, palette.shadow);
  addText(shapes, 'WET', 120, 207, 18, palette.ink, { align: 'center' });
  addText(shapes, 'FLOOR', 120, 230, 18, palette.ink, { align: 'center' });
  return asset('decoy-wet-floor-aframe', 240, 300, shapes, 'Wet-floor A-frame decoy');
}

function decoySwimPoster(palette) {
  const shapes = [];
  panel(shapes, 10, 10, 420, 280, palette, 'STROKE IN 4 STEPS');
  for (let i = 0; i < 4; i += 1) {
    const x = 70 + i * 94;
    shapes.push(rect(x - 35, 90, 70, 132, palette.paper, { rx: 7, opacity: 0.88 }));
    addText(shapes, String(i + 1), x, 105, 18, palette.red, { align: 'center' });
    drawStandingPerson(shapes, x, 138, 0.65, i % 2 === 0 ? palette.ink : palette.inkSoft);
  }
  addText(shapes, 'SWIM SCHOOL', 220, 252, 14, palette.cream, { align: 'center' });
  return asset('decoy-swim-school-poster', 440, 300, shapes, 'Four-figure swim-school poster decoy');
}

function decoyKioskMascot(palette) {
  const shapes = [];
  panel(shapes, 10, 10, 300, 280, palette, 'SUNDAE BAR');
  shapes.push(rect(68, 72, 184, 158, palette.paper, { rx: 12, opacity: 0.86 }));
  drawMascot(shapes, 160, 118, 1.15, palette.ink, palette.inkSoft);
  shapes.push(poly([[122, 188], [198, 188], [160, 252]], palette.red, { opacity: 0.9 }));
  addText(shapes, 'SOFT SERVE', 160, 255, 14, palette.ink, { align: 'center' });
  return asset('decoy-kiosk-mascot-panel', 320, 300, shapes, 'Kiosk mascot panel decoy');
}

function hideLi02(style) {
  const fill = style.body;
  const shade = style.shade;
  const shapes = [];
  shapes.push(circle(88, 94, 17, fill));
  shapes.push(line(101, 109, 150, 145, 34, fill));
  shapes.push(line(99, 112, 58, 93, 15, fill));
  shapes.push(line(104, 121, 63, 143, 15, fill));
  shapes.push(line(148, 145, 209, 131, 16, fill));
  shapes.push(line(143, 153, 203, 174, 16, fill));
  shapes.push(circle(214, 130, 7, fill));
  shapes.push(circle(208, 176, 7, fill));
  shapes.push(ellipse(126, 128, 13, 9, shade, { opacity: 0.36 }));
  return asset('li-02-no-diving', 256, 256, shapes, 'li-02 dive-pose sign hide');
}

function hideLi07(style) {
  const fill = style.body;
  const shade = style.shade;
  const shapes = [];
  shapes.push(circle(130, 54, 17, fill));
  shapes.push(line(130, 75, 128, 142, 31, fill));
  shapes.push(line(123, 91, 83, 82, 15, fill));
  shapes.push(line(137, 92, 177, 84, 15, fill));
  shapes.push(line(126, 144, 101, 198, 16, fill));
  shapes.push(line(132, 144, 161, 198, 16, fill));
  shapes.push(ellipse(128, 124, 12, 18, shade, { opacity: 0.34 }));
  return asset('li-07-fifth-poster-figure', 256, 256, shapes, 'li-07 unnumbered fifth poster figure hide');
}

function hideLi08(style) {
  const fill = style.body;
  const shade = style.shade;
  const shapes = [];
  drawSlippingPerson(shapes, 70, 72, 1.35, fill, style.shadow);
  shapes.push(ellipse(122, 142, 18, 10, shade, { opacity: 0.32 }));
  return asset('li-08-slipping-man', 256, 256, shapes, 'li-08 slipping-man wet-floor hide with contact shadow');
}

function hideLi10(style) {
  const fill = style.body;
  const shade = style.shade;
  const shapes = [];
  drawMascot(shapes, 128, 68, 1.55, fill, shade);
  shapes.push(ellipse(128, 115, 22, 13, shade, { opacity: 0.3 }));
  return asset('li-10-soft-serve-mascot', 256, 256, shapes, 'li-10 soft-serve mascot hide with pill hands');
}

const DECOYS = [
  decoyRulesBoard,
  decoyNoRunning,
  decoyDepthMarkers,
  decoyWetFloor,
  decoySwimPoster,
  decoyKioskMascot,
];

const HIDES = [
  hideLi02,
  hideLi07,
  hideLi08,
  hideLi10,
];

function asset(id, width, height, shapes, title) {
  return { id, width, height, shapes, title };
}

function paintedStyle(palette) {
  return {
    body: palette.ink,
    shade: palette.inkSoft,
    shadow: palette.shadow,
  };
}

function whiteStyle(palette) {
  return {
    body: palette.whiteBody,
    shade: palette.whiteShade,
    shadow: palette.shadow,
  };
}

function parseHex(hex) {
  const raw = hex.replace('#', '');
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function bounds(shape) {
  switch (shape.type) {
    case 'rect':
      return [shape.x, shape.y, shape.x + shape.w, shape.y + shape.h];
    case 'circle':
      return [shape.cx - shape.r, shape.cy - shape.r, shape.cx + shape.r, shape.cy + shape.r];
    case 'ellipse':
      return [shape.cx - shape.rx, shape.cy - shape.ry, shape.cx + shape.rx, shape.cy + shape.ry];
    case 'line': {
      const pad = shape.width / 2;
      return [
        Math.min(shape.x1, shape.x2) - pad,
        Math.min(shape.y1, shape.y2) - pad,
        Math.max(shape.x1, shape.x2) + pad,
        Math.max(shape.y1, shape.y2) + pad,
      ];
    }
    case 'poly': {
      const xs = shape.points.map((p) => p[0]);
      const ys = shape.points.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    default:
      throw new Error(`unknown shape type ${shape.type}`);
  }
}

function insideShape(shape, x, y) {
  switch (shape.type) {
    case 'rect':
      return insideRoundedRect(shape, x, y);
    case 'circle':
      return (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.r ** 2;
    case 'ellipse':
      return ((x - shape.cx) / shape.rx) ** 2 + ((y - shape.cy) / shape.ry) ** 2 <= 1;
    case 'line':
      return distanceToSegment(x, y, shape.x1, shape.y1, shape.x2, shape.y2) <= shape.width / 2;
    case 'poly':
      return insidePolygon(shape.points, x, y);
    default:
      throw new Error(`unknown shape type ${shape.type}`);
  }
}

function insideRoundedRect(shape, x, y) {
  if (x < shape.x || x > shape.x + shape.w || y < shape.y || y > shape.y + shape.h) return false;
  const r = Math.min(shape.rx ?? 0, shape.w / 2, shape.h / 2);
  if (r <= 0) return true;
  const cx = x < shape.x + r ? shape.x + r : x > shape.x + shape.w - r ? shape.x + shape.w - r : x;
  const cy = y < shape.y + r ? shape.y + r : y > shape.y + shape.h - r ? shape.y + shape.h - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return Math.hypot(px - x, py - y);
}

function insidePolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function blend(data, width, x, y, fill, alpha) {
  if (alpha <= 0) return;
  const idx = (y * width + x) * 4;
  const dstA = data[idx + 3] / 255;
  const srcA = alpha;
  const outA = srcA + dstA * (1 - srcA);
  const src = parseHex(fill);
  if (outA <= 0) return;
  data[idx] = Math.round((src.r * srcA + data[idx] * dstA * (1 - srcA)) / outA);
  data[idx + 1] = Math.round((src.g * srcA + data[idx + 1] * dstA * (1 - srcA)) / outA);
  data[idx + 2] = Math.round((src.b * srcA + data[idx + 2] * dstA * (1 - srcA)) / outA);
  data[idx + 3] = Math.round(outA * 255);
}

function renderPng(width, height, shapes, background = null) {
  const data = new Uint8Array(width * height * 4);
  if (background) {
    const bg = parseHex(background);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = bg.r;
      data[i + 1] = bg.g;
      data[i + 2] = bg.b;
      data[i + 3] = 255;
    }
  }

  for (const shape of shapes) {
    const [minX, minY, maxX, maxY] = bounds(shape);
    const x0 = Math.max(0, Math.floor(minX) - 1);
    const y0 = Math.max(0, Math.floor(minY) - 1);
    const x1 = Math.min(width - 1, Math.ceil(maxX) + 1);
    const y1 = Math.min(height - 1, Math.ceil(maxY) + 1);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        let hits = 0;
        for (const oy of SAMPLE_OFFSETS) {
          for (const ox of SAMPLE_OFFSETS) {
            if (insideShape(shape, x + ox, y + oy)) hits += 1;
          }
        }
        if (hits > 0) blend(data, width, x, y, shape.fill, (shape.opacity ?? 1) * (hits / 4));
      }
    }
  }

  return encodePng(width, height, data);
}

function shapeToSvg(shape) {
  const attrs = [`fill="${shape.fill}"`];
  if ((shape.opacity ?? 1) !== 1) attrs.push(`opacity="${shape.opacity}"`);
  switch (shape.type) {
    case 'rect':
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${shape.rx ?? 0}" ${attrs.join(' ')} />`;
    case 'circle':
      return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" ${attrs.join(' ')} />`;
    case 'ellipse':
      return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}" ${attrs.join(' ')} />`;
    case 'line':
      return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" stroke="${shape.fill}" stroke-width="${shape.width}" stroke-linecap="round" opacity="${shape.opacity ?? 1}" />`;
    case 'poly':
      return `<polygon points="${shape.points.map((p) => p.join(',')).join(' ')}" ${attrs.join(' ')} />`;
    default:
      throw new Error(`unknown shape type ${shape.type}`);
  }
}

function escapeXml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function svgFor(assetDef, meta) {
  const body = assetDef.shapes.map((shape) => `  ${shapeToSvg(shape)}`).join('\n');
  const metadata = JSON.stringify(meta);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${assetDef.width}" height="${assetDef.height}" viewBox="0 0 ${assetDef.width} ${assetDef.height}" role="img">`,
    `  <title>${escapeXml(assetDef.title)}</title>`,
    `  <desc>${escapeXml('Authored vector source for Cameleon sign-lane sprite. Text and colors are generated from script parameters.')}</desc>`,
    `  <metadata>${escapeXml(metadata)}</metadata>`,
    body,
    '</svg>',
    '',
  ].join('\n');
}

function writeAsset(assetDef, outGroup, fileName, meta, entries) {
  const pngPath = join(SPRITES_DIR, outGroup, `${fileName}.png`);
  const svgPath = join(SPRITES_DIR, 'source', outGroup, `${fileName}.svg`);
  mkdirSync(dirname(pngPath), { recursive: true });
  mkdirSync(dirname(svgPath), { recursive: true });
  writeFileSync(svgPath, svgFor(assetDef, meta));
  writeFileSync(pngPath, renderPng(assetDef.width, assetDef.height, assetDef.shapes));
  entries.push({
    ...meta,
    id: fileName,
    group: outGroup,
    pngPath,
    svgPath,
    width: assetDef.width,
    height: assetDef.height,
    title: assetDef.title,
  });
}

function relGame(path) {
  return relative(GAME_ROOT, path).split('/').join('/');
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeManifest(entries) {
  const assets = {
    'design/assets/placeholder_logo.svg': {
      source: 'design/assets/placeholder_logo.svg',
      expectation: 'exact-bytes',
      provenance: 'Template placeholder asset retained until Cameleon-specific chrome replaces it.',
    },
  };

  for (const entry of entries) {
    const svgRel = relGame(entry.svgPath);
    const pngRel = relGame(entry.pngPath);
    assets[svgRel] = {
      source: svgRel,
      expectation: 'exact-bytes',
      provenance: {
        authored: true,
        generated: false,
        card: 'JWZ5Un6g',
        script: SCRIPT_REL,
        kind: entry.kind,
        palette: entry.palette,
        designRefs: DESIGN_REFS,
      },
    };
    assets[pngRel] = {
      source: svgRel,
      expectation: 'intentionally-different',
      reason: 'Rendered PNG from authored SVG/vector primitives by the local sign-lane asset script.',
      provenance: {
        authored: true,
        generated: false,
        card: 'JWZ5Un6g',
        script: SCRIPT_REL,
        kind: entry.kind,
        palette: entry.palette,
        dimensions: { width: entry.width, height: entry.height },
        bytes: readFileSync(entry.pngPath).length,
        sha256: sha256(entry.pngPath),
        designRefs: DESIGN_REFS,
      },
    };
  }

  const manifest = {
    version: 1,
    coverage: 'complete',
    notes: 'Cameleon sign-lane level sprites are authored vectors rendered locally at zero image-generation cost. Non-design level sprite entries document provenance; the current audit linter enforces design/assets only.',
    assets,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

function drawPngOnto(data, width, image, dx, dy, scale) {
  const drawW = Math.max(1, Math.round(image.width * scale));
  const drawH = Math.max(1, Math.round(image.height * scale));
  for (let y = 0; y < drawH; y += 1) {
    for (let x = 0; x < drawW; x += 1) {
      const tx = dx + x;
      const ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= width) continue;
      const sx = Math.min(image.width - 1, Math.floor(x / scale));
      const sy = Math.min(image.height - 1, Math.floor(y / scale));
      const src = (sy * image.width + sx) * 4;
      const alpha = image.data[src + 3] / 255;
      if (alpha <= 0) continue;
      const fill = `#${[image.data[src], image.data[src + 1], image.data[src + 2]]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')}`;
      blend(data, width, tx, ty, fill, alpha);
    }
  }
}

function writeContactSheet(entries) {
  const cols = 4;
  const cellW = 460;
  const cellH = 360;
  const headerH = 76;
  const rows = Math.ceil(entries.length / cols);
  const width = cols * cellW;
  const height = headerH + rows * cellH;
  const shapes = [];
  shapes.push(rect(0, 0, width, height, '#f5efd5'));
  addText(shapes, 'CAMELEON SIGN LANE - AUTHORED VECTOR SPRITES', 24, 24, 24, '#103943');
  const data = decodePng(renderPng(width, height, shapes)).data;

  entries.forEach((entry, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = col * cellW;
    const y = headerH + row * cellH;
    const tileShapes = [
      rect(x + 16, y + 14, cellW - 32, cellH - 28, '#fff9df', { rx: 10 }),
      rect(x + 28, y + 26, cellW - 56, 250, entry.palette === 'night' ? '#182544' : '#fff3c4', { rx: 8 }),
    ];
    const tilePng = decodePng(renderPng(width, height, tileShapes));
    for (let i = 0; i < data.length; i += 4) {
      if (tilePng.data[i + 3] > 0) {
        data[i] = tilePng.data[i];
        data[i + 1] = tilePng.data[i + 1];
        data[i + 2] = tilePng.data[i + 2];
        data[i + 3] = tilePng.data[i + 3];
      }
    }

    const image = decodePng(readFileSync(entry.pngPath));
    const maxW = 360;
    const maxH = 220;
    const scale = Math.min(maxW / image.width, maxH / image.height, entry.kind.startsWith('hide') ? 1.12 : 1);
    const drawW = Math.max(1, Math.round(image.width * scale));
    const drawH = Math.max(1, Math.round(image.height * scale));
    drawPngOnto(data, width, image, x + Math.floor((cellW - drawW) / 2), y + 42 + Math.floor((220 - drawH) / 2), scale);

    const labelShapes = [];
    addText(labelShapes, `${entry.group}/${entry.id}`, x + 30, y + 296, 14, '#103943');
    addText(labelShapes, entry.kind.toUpperCase(), x + 30, y + 320, 12, '#df4540');
    const labelPng = decodePng(renderPng(width, height, labelShapes));
    for (let i = 0; i < data.length; i += 4) {
      if (labelPng.data[i + 3] > 0) {
        data[i] = labelPng.data[i];
        data[i + 1] = labelPng.data[i + 1];
        data[i + 2] = labelPng.data[i + 2];
        data[i + 3] = labelPng.data[i + 3];
      }
    }
  });

  mkdirSync(WORK_DIR, { recursive: true });
  writeFileSync(join(WORK_DIR, 'sign-lane-contact.png'), encodePng(width, height, data));
}

function main() {
  const entries = [];
  for (const [paletteName, palette] of Object.entries(PALETTES)) {
    for (const makeDecoy of DECOYS) {
      const decoy = makeDecoy(palette);
      writeAsset(decoy, paletteName, decoy.id, { kind: 'decoy', palette: paletteName }, entries);
    }
    for (const makeHide of HIDES) {
      const painted = makeHide(paintedStyle(palette));
      writeAsset(painted, paletteName, `${painted.id}-painted`, { kind: 'hide-painted', palette: paletteName }, entries);
    }
  }

  const whitePalette = PALETTES.poster;
  for (const makeHide of HIDES) {
    const white = makeHide(whiteStyle(whitePalette));
    writeAsset(white, 'white', `${white.id}-white`, { kind: 'hide-white', palette: 'white' }, entries);
  }

  writeManifest(entries);
  writeContactSheet(entries);

  const manifestRel = relGame(MANIFEST_PATH);
  const contactRel = relGame(join(WORK_DIR, 'sign-lane-contact.png'));
  const count = entries.filter((entry) => entry.pngPath.endsWith('.png')).length;
  if (!existsSync(MANIFEST_PATH)) throw new Error(`manifest missing: ${manifestRel}`);
  console.log(`sign-lane assets: rendered ${count} PNGs + SVG sources`);
  console.log(`manifest: ${manifestRel}`);
  console.log(`contact sheet: ${contactRel}`);
}

main();
