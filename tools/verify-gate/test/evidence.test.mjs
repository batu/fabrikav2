import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newestMtimeMs, panelMtimesMs } from '../src/evidence.mjs';
import { evidenceIsFresh } from '../src/classify.mjs';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-gate-ev-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(rel, mtimeMs) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'x');
  if (mtimeMs != null) fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
  return p;
}

describe('newestMtimeMs', () => {
  it('returns the newest mtime among stat-able files, ignoring absent ones', () => {
    write('games/g/src/a.ts', 1000);
    write('games/g/src/b.ts', 3000);
    const t = newestMtimeMs(['games/g/src/a.ts', 'games/g/src/b.ts', 'games/g/src/gone.ts'], dir);
    expect(t).toBe(3000);
  });
  it('returns null when nothing stats', () => {
    expect(newestMtimeMs(['games/g/src/gone.ts'], dir)).toBe(null);
  });
});

describe('panelMtimesMs (real globSync)', () => {
  it('discovers panel.json under docs/evidence/*device-verify* and games/*/evidence', () => {
    write('docs/evidence/2026-07-07-device-verify/panel.json', 5000);
    write('docs/evidence/2026-07-07-other-report/panel.json', 9000); // not a *device-verify* dir
    write('games/marble_run/evidence/2026-07-07-run/panel.json', 4000);
    const times = panelMtimesMs(dir).sort((a, b) => a - b);
    expect(times).toEqual([4000, 5000]); // the non-device-verify one is excluded
  });
  it('returns [] when there are no panels', () => {
    expect(panelMtimesMs(dir)).toEqual([]);
  });
});

describe('freshness end-to-end (fs -> pure compare)', () => {
  it('STALE panel (older than change) is not fresh -> would block', () => {
    write('games/g/src/menu.ts', 8000);
    write('docs/evidence/2026-07-07-device-verify/panel.json', 3000);
    const newest = newestMtimeMs(['games/g/src/menu.ts'], dir);
    expect(evidenceIsFresh(newest, panelMtimesMs(dir))).toBe(false);
  });
  it('FRESH panel (newer than change) is fresh -> would pass', () => {
    write('games/g/src/menu.ts', 3000);
    write('docs/evidence/2026-07-07-device-verify/panel.json', 8000);
    const newest = newestMtimeMs(['games/g/src/menu.ts'], dir);
    expect(evidenceIsFresh(newest, panelMtimesMs(dir))).toBe(true);
  });
});
