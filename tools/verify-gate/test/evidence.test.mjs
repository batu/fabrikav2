import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newestMtimeMs, newestVisualChangeMs, panelMtimesMs, readPanelEvidence } from '../src/evidence.mjs';
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

function writeJson(rel, obj, mtimeMs) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
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

describe('newestVisualChangeMs', () => {
  it('reports missing files and uses git history timestamps when supplied', () => {
    write('games/g/src/present.ts', 1000);
    const run = (cmd) => cmd.includes('gone.ts')
      ? { ok: true, stdout: '3\n' }
      : { ok: false, stdout: '' };
    const res = newestVisualChangeMs(['games/g/src/present.ts', 'games/g/src/gone.ts'], dir, { run });
    expect(res.missingFiles).toEqual(['games/g/src/gone.ts']);
    expect(res.newestChangeMs).toBe(3000);
  });

  it('returns null when every file is missing and git has no deletion timestamp', () => {
    const res = newestVisualChangeMs(['games/g/src/gone.ts'], dir, { run: () => ({ ok: false, stdout: '' }) });
    expect(res).toEqual({ newestChangeMs: null, missingFiles: ['games/g/src/gone.ts'] });
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

describe('readPanelEvidence', () => {
  it('parses structured panel metadata', () => {
    writeJson('docs/evidence/2026-07-07-device-verify/panel.json', {
      game: 'marble_run',
      lane: 'device',
      generatedAt: '2026-07-07T10:00:00.000Z',
      verdict: { pass: true },
      states: [],
    });
    expect(readPanelEvidence(dir)).toEqual([{
      path: 'docs/evidence/2026-07-07-device-verify/panel.json',
      valid: true,
      game: 'marble_run',
      lane: 'device',
      generatedAtMs: Date.parse('2026-07-07T10:00:00.000Z'),
      verdictPass: true,
    }]);
  });

  it('marks corrupt or legacy panels invalid rather than satisfying the gate', () => {
    write('docs/evidence/2026-07-07-device-verify/panel.json', 1000);
    writeJson('games/marble_run/evidence/run/panel.json', { verdict: { pass: true } }, 2000);
    const evidence = readPanelEvidence(dir);
    expect(evidence).toHaveLength(2);
    expect(evidence.every((p) => p.valid === false)).toBe(true);
    expect(evidence.map((p) => p.error).join('\n')).toMatch(/valid JSON|metadata/);
  });
});

describe('freshness end-to-end (fs -> pure compare)', () => {
  it('STALE panel (older than change) is not fresh -> would block', () => {
    write('games/g/src/menu.ts', 8000);
    writeJson('docs/evidence/2026-07-07-device-verify/panel.json', {
      game: 'g', lane: 'device', generatedAt: '1970-01-01T00:00:03.000Z', verdict: { pass: true },
    }, 3000);
    const { newestChangeMs } = newestVisualChangeMs(['games/g/src/menu.ts'], dir);
    expect(evidenceIsFresh(newestChangeMs, readPanelEvidence(dir), ['g'])).toBe(false);
  });
  it('FRESH panel (newer than change) is fresh -> would pass', () => {
    write('games/g/src/menu.ts', 3000);
    writeJson('docs/evidence/2026-07-07-device-verify/panel.json', {
      game: 'g', lane: 'device', generatedAt: '1970-01-01T00:00:08.000Z', verdict: { pass: true },
    }, 8000);
    const { newestChangeMs } = newestVisualChangeMs(['games/g/src/menu.ts'], dir);
    expect(evidenceIsFresh(newestChangeMs, readPanelEvidence(dir), ['g'])).toBe(true);
  });
});
