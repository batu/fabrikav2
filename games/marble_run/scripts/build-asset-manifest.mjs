#!/usr/bin/env node
// Ports v1 sugar3d assets into v2 marble_run and emits docs/asset-manifest.json.
// One-shot + idempotent: re-running re-copies and rewrites the manifest.
// Enforcement lives in tests/unit/asset-manifest.test.ts.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ASSET_ROOTS, V1_ROOT, listAssets, sha256 } from './asset-inventory.mjs';

const gameDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(gameDir, 'docs', 'asset-manifest.json');

const entries = [];
for (const root of ASSET_ROOTS) {
  for (const v1Path of listAssets(join(V1_ROOT, root.from))) {
    const rel = relative(join(V1_ROOT, root.from), v1Path);
    const v2Rel = join(root.to, rel);
    const dest = join(gameDir, v2Rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(v1Path, dest);
    const bytes = readFileSync(v1Path);
    entries.push({
      v1Path: relative(V1_ROOT, v1Path),
      v2Path: v2Rel,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
}

entries.sort((a, b) => a.v1Path.localeCompare(b.v1Path));

const manifest = {
  v1Root: V1_ROOT,
  generatedBy: 'games/marble_run/scripts/build-asset-manifest.mjs',
  totalAssets: entries.length,
  totalBytes: entries.reduce((sum, e) => sum + e.bytes, 0),
  assets: entries,
};

mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`${manifest.totalAssets} assets, ${manifest.totalBytes} bytes → ${relative(gameDir, manifestPath)}`);
