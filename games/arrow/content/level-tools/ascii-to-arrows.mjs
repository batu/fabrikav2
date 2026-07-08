#!/usr/bin/env node
/**
 * ascii-to-arrows.mjs — convert an ASCII-art grid into an explicit
 * arrows yaml recipe.
 *
 * Input format (stdin or --file <path>): a rectangular grid where each
 * character is either:
 *   '.'      — empty cell
 *   '>^<v'   — head-with-direction, a single-cell arrow head
 *   'a-z'    — arrow body cell; all cells with the same letter form
 *              one polyline in the order they appear when walked from
 *              the head. At most one head per letter; if no head, the
 *              nearest-edge endpoint of the component becomes the head
 *              and its direction is inferred toward that edge.
 *
 * Example (a plus sign on 7x7):
 *   . . . A . . .
 *   . . . a . . .
 *   . . . a . . .
 *   B b b . c c C
 *   . . . d . . .
 *   . . . d . . .
 *   . . . D . . .
 *
 * A/B/C/D are heads (uppercase), a/b/c/d are body cells. Four separate
 * arrows, each pointing outward toward a grid edge.
 *
 * Output: a yaml recipe snippet ready to concatenate under `arrows:`.
 *
 * Usage:
 *   node content/level-tools/ascii-to-arrows.mjs --file levels/drafts/face.txt
 *   node content/level-tools/ascii-to-arrows.mjs --file X.txt --title "Face" \
 *        --pack pictograms --indexInPack 4 --out levels/pictograms/04-face.yaml
 */

import { readFileSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  const args = { out: null, file: null, pack: null, indexInPack: null, title: null, difficulty: "medium" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") args.file = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--pack") args.pack = argv[++i];
    else if (a === "--indexInPack") args.indexInPack = Number(argv[++i]);
    else if (a === "--title") args.title = argv[++i];
    else if (a === "--difficulty") args.difficulty = argv[++i];
  }
  return args;
}

function parseGrid(src) {
  // Strip whitespace between chars — authors tend to pad with spaces
  // for readability. A row becomes a compact string. Comment lines
  // (leading '#') are skipped entirely.
  const rows = src
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .map((line) => line.replace(/\s+/g, ""))
    .filter((line) => line.length > 0);
  if (rows.length === 0) throw new Error("grid is empty");
  const width = rows[0].length;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length !== width) {
      throw new Error(`row ${i + 1} has width ${rows[i].length}, expected ${width}`);
    }
  }
  return { rows, cols: width, rows_: rows.length };
}

// 4-connected neighbor deltas
const NB = [
  { dx: 0, dy: -1, dir: "N" },
  { dx: 1, dy: 0, dir: "E" },
  { dx: 0, dy: 1, dir: "S" },
  { dx: -1, dy: 0, dir: "W" },
];

function cellKey(x, y) { return `${x},${y}`; }
function cellLetter(ch) { return ch.toLowerCase(); }
function isBody(ch) { return /[a-z]/.test(ch); }
function isHead(ch) { return /[A-Z]/.test(ch); }

function extractComponents(grid) {
  // Map letter → list of cells (in row-major order). Heads are marked.
  const byLetter = new Map();
  for (let y = 0; y < grid.rows.length; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const ch = grid.rows[y][x];
      if (ch === "." || ch === "") continue;
      if (!isBody(ch) && !isHead(ch)) continue;
      const letter = cellLetter(ch);
      if (!byLetter.has(letter)) byLetter.set(letter, []);
      byLetter.get(letter).push({ x, y, isHead: isHead(ch) });
    }
  }
  return byLetter;
}

// Order the cells of one arrow as a polyline. Returns an array of
// [x,y] pairs in walk order; the head is the LAST cell.
function orderPolyline(cells, cols, rows_) {
  if (cells.length < 2) throw new Error(`arrow has only ${cells.length} cell(s); need >= 2`);
  const set = new Set(cells.map((c) => cellKey(c.x, c.y)));

  // Build adjacency and find endpoints (degree-1).
  const degree = new Map();
  for (const c of cells) {
    let d = 0;
    for (const n of NB) {
      if (set.has(cellKey(c.x + n.dx, c.y + n.dy))) d++;
    }
    degree.set(cellKey(c.x, c.y), d);
  }
  const endpoints = cells.filter((c) => degree.get(cellKey(c.x, c.y)) === 1);
  if (endpoints.length !== 2) {
    throw new Error(
      `arrow must be a simple polyline (2 endpoints), got ${endpoints.length}: cells = ${JSON.stringify(cells)}`,
    );
  }

  // Pick head: author-marked if present, otherwise the endpoint closer
  // to a grid edge (smaller min-distance to edge).
  const marked = cells.find((c) => c.isHead);
  let head, tail;
  if (marked) {
    head = marked;
    tail = endpoints.find((e) => !(e.x === head.x && e.y === head.y));
    if (!tail) throw new Error(`head ${JSON.stringify(head)} isn't an endpoint`);
    if (!endpoints.find((e) => e.x === head.x && e.y === head.y)) {
      throw new Error(`head ${JSON.stringify(head)} isn't an endpoint — it has a neighbor on both sides`);
    }
  } else {
    const edgeDist = (c) => Math.min(c.x, c.y, cols - 1 - c.x, rows_ - 1 - c.y);
    endpoints.sort((a, b) => edgeDist(a) - edgeDist(b));
    head = endpoints[0];
    tail = endpoints[1];
  }

  // Walk from tail to head, appending neighbors.
  const path = [[tail.x, tail.y]];
  const visited = new Set([cellKey(tail.x, tail.y)]);
  while (path.length < cells.length) {
    const [cx, cy] = path[path.length - 1];
    let advanced = false;
    for (const n of NB) {
      const nx = cx + n.dx, ny = cy + n.dy;
      const key = cellKey(nx, ny);
      if (set.has(key) && !visited.has(key)) {
        path.push([nx, ny]);
        visited.add(key);
        advanced = true;
        break;
      }
    }
    if (!advanced) break;
  }
  if (path.length !== cells.length) {
    throw new Error(`walk terminated early at ${path.length}/${cells.length} cells — not a simple polyline`);
  }
  const last = path[path.length - 1];
  if (last[0] !== head.x || last[1] !== head.y) {
    // Reverse if we walked from head to tail.
    path.reverse();
  }
  return path;
}

function toYaml(cols, rows_, arrows, opts) {
  const arrJson = JSON.stringify(arrows).replace(/,/g, ",").replace(/ /g, "");
  const lines = [
    `cols: ${cols}`,
    `rows: ${rows_}`,
    `arrows: ${arrJson}`,
  ];
  if (opts.transform) lines.push(`transform: ${opts.transform}`);
  lines.push("meta:");
  if (opts.pack) lines.push(`  pack: ${opts.pack}`);
  if (opts.indexInPack !== null && opts.indexInPack !== undefined) lines.push(`  indexInPack: ${opts.indexInPack}`);
  if (opts.title) lines.push(`  title: ${opts.title}`);
  if (opts.difficulty) lines.push(`  difficulty: ${opts.difficulty}`);
  return lines.join("\n") + "\n";
}

function main() {
  const args = parseArgs(process.argv);
  const src = args.file ? readFileSync(args.file, "utf8") : readFileSync(0, "utf8");
  const grid = parseGrid(src);
  const byLetter = extractComponents(grid);
  if (byLetter.size === 0) throw new Error("no arrows found in grid");

  const arrows = [];
  for (const [letter, cells] of [...byLetter.entries()].sort()) {
    try {
      const path = orderPolyline(cells, grid.cols, grid.rows.length);
      arrows.push(path);
    } catch (e) {
      throw new Error(`arrow '${letter}': ${e.message}`);
    }
  }

  const yaml = toYaml(grid.cols, grid.rows.length, arrows, args);
  if (args.out) {
    writeFileSync(args.out, yaml);
    console.log(`wrote ${args.out}  (${arrows.length} arrows, ${grid.cols}x${grid.rows.length})`);
  } else {
    process.stdout.write(yaml);
  }
}

main();
