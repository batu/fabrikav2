import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameManifest } from '../../refcap-compare/src/run.mjs';
import { buildRows } from '../src/compare.mjs';
import { computeVerdict } from '../src/verdict.mjs';

// Integration over the REAL marble_run manifest + committed reference PNGs, using
// the reference captures themselves as stand-in "device" captures. This exercises
// the actual reuse path (refcap-compare png/diff + the shared manifest) end-to-end
// without a device: identical device==reference => ~0% diff => PASS.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('buildRows + verdict (reuse path, offline)', () => {
  let manifest;
  let capturesDir;
  let deviceCaptures;

  beforeAll(() => {
    manifest = loadGameManifest('marble_run', REPO_ROOT);
    capturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-cmp-'));
    deviceCaptures = {};
    // Copy each state's committed reference PNG in as the "device" capture.
    for (const st of manifest.states) {
      if (st.reference?.offline) {
        const src = path.join(manifest.gameDir, st.reference.offline);
        const dst = path.join(capturesDir, `${st.name}.png`);
        fs.copyFileSync(src, dst);
        deviceCaptures[st.name] = dst;
      }
    }
    // Drop one state to prove "missing device capture" is caught.
    delete deviceCaptures.fail;
  });

  afterAll(() => fs.rmSync(capturesDir, { recursive: true, force: true }));

  it('produces one row per canonical state', () => {
    const { rows } = buildRows({ manifest, deviceCaptures });
    expect(rows.map((r) => r.state)).toEqual(manifest.states.map((s) => s.name));
  });

  it('identical device==reference diffs to ~0% (real refcap-compare diff)', () => {
    const { rows } = buildRows({ manifest, deviceCaptures });
    const menu = rows.find((r) => r.state === 'menu');
    expect(menu.device.gap).toBeFalsy();
    expect(menu.reference.gap).toBeFalsy();
    expect(menu.diff.changedFraction).toBeLessThan(0.02);
  });

  it('a state with no device capture is flagged missing (fail)', () => {
    const { rows } = buildRows({ manifest, deviceCaptures });
    const verdict = computeVerdict(rows, 0.2);
    expect(verdict.states.find((s) => s.state === 'fail').status).toBe('missing');
    expect(verdict.pass).toBe(false);
  });

  it('a documented reference gap (pause) yields no-reference, not a crash', () => {
    // pause has no device capture here either (reference is a gap) — but if a
    // device capture existed it would be no-reference. Assert the reference gap
    // is surfaced explicitly on the row.
    const { rows } = buildRows({ manifest, deviceCaptures });
    const pause = rows.find((r) => r.state === 'pause');
    expect(pause.reference.gap).toBeTruthy();
  });
});
