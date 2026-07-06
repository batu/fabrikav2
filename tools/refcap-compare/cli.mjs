#!/usr/bin/env node
// refcap-compare — paired reference(android)+v2 capture -> side-by-side grid per
// canonical state. Fixes ledger C4/B1/B2/B3 + the package-stamp near-miss.
//
// Usage:
//   node tools/refcap-compare/cli.mjs --game marble_run --offline
//   npm run refcap-compare -- --game marble_run
//
// Flags:
//   --game <name>   required. games/<name>/refs/manifest.yaml must exist.
//   --offline       consume committed refs/ + evidence/ PNGs (no device). Default
//                   in the worker sandbox; the AC/verification path.
//   --out <dir>     output dir (default games/<game>/evidence/<date>-refcap-compare)
//   --date <YYYY-MM-DD>  stamp used in default --out and the HTML header.
//   --serial <id>   adb device serial (live reference lane only).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameManifest, buildOfflineRows } from './src/run.mjs';
import { buildGridHtml } from './src/grid.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  const args = { offline: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') args.offline = true;
    else if (a === '--game') args.game = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--date') args.date = argv[++i];
    else if (a === '--serial') args.serial = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

const HELP = `refcap-compare — paired android+v2 comparison grid
Usage: node tools/refcap-compare/cli.mjs --game <name> [--offline] [--out <dir>] [--date <YYYY-MM-DD>]
`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return 0; }
  if (!args.game) throw new Error('--game is required');

  const date = args.date || new Date().toISOString().slice(0, 10);
  const manifest = loadGameManifest(args.game, REPO_ROOT);

  // The per-lane live-capture functions (reference adb, v2 harness) are coded and
  // unit-tested in src/capture.mjs, but end-to-end live orchestration needs a
  // device serial AND the sibling harness driveTo card — neither present here. The
  // grid is therefore built from committed captures. The AC explicitly allows
  // "offline mode ok" when live capture is unavailable; we announce the fallback
  // rather than silently implying a live run. --offline requests this path directly.
  if (!args.offline) {
    process.stderr.write(
      'refcap-compare: live capture lanes are coded but not wired end-to-end yet ' +
      '(reference lane needs a device; v2 lane needs the harness driveTo card) — ' +
      'building the grid from committed captures.\n'
    );
  }

  const { rows, captures } = buildOfflineRows(manifest);
  const mode = 'offline';
  const html = buildGridHtml({ game: args.game, generatedAt: date, mode, rows });

  const outDir = args.out
    ? path.resolve(args.out)
    : path.join(manifest.gameDir, 'evidence', `${date}-refcap-compare`);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'grid.html');
  fs.writeFileSync(outFile, html);

  const gaps = rows.flatMap((r) =>
    [['reference', r.reference], ['v2', r.v2]]
      .filter(([, c]) => c.gap)
      .map(([lane]) => `${r.state}/${lane}`)
  );
  process.stdout.write(
    `refcap-compare: ${rows.length} states, ${captures.length} captures, ` +
    `dedup guard passed.\n` +
    `  documented gaps: ${gaps.length ? gaps.join(', ') : 'none'}\n` +
    `  grid: ${path.relative(REPO_ROOT, outFile)}\n`
  );
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  process.stderr.write(`refcap-compare: ${err.message}\n`);
  process.exit(1);
}
