// Shared inventory rules for the v1 sugar3d → v2 marble_run asset port.
// Used by both the generator script and the two-way manifest test so the
// generator can never disagree with the check about what an "asset" is.

import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Canonical v1 checkout (fabrika v1, "Sugar3D").
export const V1_ROOT = '/Users/base/dev/appletolye/fabrika/games/marble_run/sugar3d';

// Every file under these roots is an asset — no extension allowlist, so a
// non-image native resource (e.g. ic_launcher_background.xml) cannot silently
// be dropped from a port that claims to be 1:1. Build output (dist/) and the
// generated android/ ios/ platform copies are outside these roots by design.
export const ASSET_ROOTS = [
  { from: 'src/ui/assets', to: 'public/v1/ui' },
  { from: 'native-resources/android-res', to: 'native-resources/android-res' },
];

/** Absolute paths of every file under `dir`, recursively, sorted. */
export function listAssets(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
