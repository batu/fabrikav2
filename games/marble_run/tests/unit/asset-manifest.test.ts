// Two-way proof that the v1 sugar3d → v2 marble_run asset port is 1:1:
// nothing missing, nothing invented, nothing changed — in either direction.
// Regenerate with: node games/marble_run/scripts/build-asset-manifest.mjs

import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error -- plain .mjs helper shared with the generator script
import { ASSET_ROOTS, V1_ROOT, listAssets, sha256 } from '../../scripts/asset-inventory.mjs';

interface Entry {
  v1Path: string;
  v2Path: string;
  bytes: number;
  sha256: string;
}

const gameDir = resolve(__dirname, '../..');
const manifest = JSON.parse(
  readFileSync(join(gameDir, 'docs/asset-manifest.json'), 'utf8'),
) as { totalAssets: number; totalBytes: number; assets: Entry[] };

const hasV1 = existsSync(V1_ROOT);

describe('asset manifest', () => {
  it('header totals agree with the entry list', () => {
    expect(manifest.assets).toHaveLength(manifest.totalAssets);
    expect(manifest.assets.reduce((s, e) => s + e.bytes, 0)).toBe(manifest.totalBytes);
  });

  it('every manifest entry matches the v2 file on disk', () => {
    const mismatched: string[] = [];
    const missing: string[] = [];
    for (const entry of manifest.assets) {
      const p = join(gameDir, entry.v2Path);
      if (!existsSync(p)) {
        missing.push(entry.v2Path);
        continue;
      }
      const buf = readFileSync(p);
      if (buf.length !== entry.bytes || sha256(buf) !== entry.sha256) mismatched.push(entry.v2Path);
    }
    expect({ missing, mismatched }).toEqual({ missing: [], mismatched: [] });
  });

  it('no v2 files under the ported roots are absent from the manifest', () => {
    const known = new Set(manifest.assets.map((e) => e.v2Path));
    const extra: string[] = [];
    for (const root of ASSET_ROOTS) {
      const dir = join(gameDir, root.to);
      if (!existsSync(dir)) continue;
      for (const p of listAssets(dir) as string[]) {
        const rel = relative(gameDir, p);
        if (!known.has(rel)) extra.push(rel);
      }
    }
    expect(extra).toEqual([]);
  });

  // The v1 checkout is a sibling repo, not vendored — skip where it is absent
  // (e.g. CI) rather than fail. Locally this is the half that proves fidelity.
  it.skipIf(!hasV1)('matches the v1 source inventory exactly, byte for byte', () => {
    const known = new Map(manifest.assets.map((e) => [e.v1Path, e]));
    const extra: string[] = [];
    const mismatched: string[] = [];
    const seen = new Set<string>();

    for (const root of ASSET_ROOTS) {
      for (const p of listAssets(join(V1_ROOT, root.from)) as string[]) {
        const rel = relative(V1_ROOT, p);
        seen.add(rel);
        const entry = known.get(rel);
        if (!entry) {
          extra.push(rel);
          continue;
        }
        const buf = readFileSync(p);
        if (buf.length !== entry.bytes || sha256(buf) !== entry.sha256) mismatched.push(rel);
      }
    }

    const missing = manifest.assets.map((e) => e.v1Path).filter((p) => !seen.has(p));
    expect({ missing, extra, mismatched }).toEqual({ missing: [], extra: [], mismatched: [] });
  });
});
