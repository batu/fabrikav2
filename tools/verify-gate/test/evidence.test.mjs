import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newestMtimeMs, newestVisualChangeMs, readPanelEvidence } from '../src/evidence.mjs';
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

  // Fresh linked worktrees stamp EVERY checkout file with "now"; a clean file's
  // real change time is its last commit, not its checkout mtime.
  function fakeGit({ dirty = [], commitSeconds = null }) {
    return (cmd) => {
      if (cmd.startsWith('git status')) {
        return { ok: true, stdout: dirty.map((f) => ` M ${f}`).join('\n') + '\n' };
      }
      if (cmd.startsWith('git log')) {
        return commitSeconds === null
          ? { ok: false, stdout: '' }
          : { ok: true, stdout: `${commitSeconds}\n` };
      }
      return { ok: false, stdout: '' };
    };
  }

  it('clean file in a fresh worktree uses commit time, not checkout mtime', () => {
    const now = Date.now();
    write('games/g/src/menu.ts', now); // checkout stamped "now"
    const run = fakeGit({ dirty: [], commitSeconds: 10 }); // committed long ago (t=10s)
    const res = newestVisualChangeMs(['games/g/src/menu.ts'], dir, { run });
    expect(res.newestChangeMs).toBe(10_000);
    expect(res.missingFiles).toEqual([]);
  });

  it('dirty file keeps mtime even when its last commit is old', () => {
    const now = Date.now();
    write('games/g/src/menu.ts', now);
    const run = fakeGit({ dirty: ['games/g/src/menu.ts'], commitSeconds: 10 });
    const res = newestVisualChangeMs(['games/g/src/menu.ts'], dir, { run });
    expect(res.newestChangeMs).toBe(fs.statSync(path.join(dir, 'games/g/src/menu.ts')).mtimeMs);
  });

  it('untracked file (dirty per git status) keeps mtime', () => {
    write('games/g/src/new.ts', 7000);
    const run = (cmd) => cmd.startsWith('git status')
      ? { ok: true, stdout: '?? games/g/src/new.ts\n' }
      : { ok: false, stdout: '' };
    const res = newestVisualChangeMs(['games/g/src/new.ts'], dir, { run });
    expect(res.newestChangeMs).toBe(7000);
  });

  it('falls back to mtime when git status fails (fail-soft)', () => {
    write('games/g/src/menu.ts', 7000);
    const res = newestVisualChangeMs(['games/g/src/menu.ts'], dir, { run: () => ({ ok: false, stdout: '' }) });
    expect(res.newestChangeMs).toBe(7000);
  });

  it('clean file with no git-log record falls back to mtime', () => {
    write('games/g/src/menu.ts', 7000);
    const run = fakeGit({ dirty: [], commitSeconds: null });
    const res = newestVisualChangeMs(['games/g/src/menu.ts'], dir, { run });
    expect(res.newestChangeMs).toBe(7000);
  });
});

describe('panel discovery (real globSync)', () => {
  it('discovers panel.json under docs/evidence/*device-verify* and games/*/evidence', () => {
    write('docs/evidence/2026-07-07-device-verify/panel.json', 5000);
    write('docs/evidence/2026-07-07-other-report/panel.json', 9000); // not a *device-verify* dir
    write('games/marble_run/evidence/2026-07-07-run/panel.json', 4000);
    const paths = readPanelEvidence(dir).map((p) => p.path);
    expect(paths).toEqual([
      'docs/evidence/2026-07-07-device-verify/panel.json',
      'games/marble_run/evidence/2026-07-07-run/panel.json',
    ]); // the non-device-verify one is excluded
  });
  it('returns [] when there are no panels', () => {
    expect(readPanelEvidence(dir)).toEqual([]);
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

  it('keeps verdict score and summary as advisory metadata', () => {
    writeJson('docs/evidence/2026-07-07-device-verify/panel.json', {
      game: 'marble_run',
      lane: 'device',
      generatedAt: '2026-07-07T10:00:00.000Z',
      verdict: { pass: false, score: 45, summary: 'FAIL — panel median 45%' },
      states: [],
    });
    expect(readPanelEvidence(dir)).toEqual([{
      path: 'docs/evidence/2026-07-07-device-verify/panel.json',
      valid: true,
      game: 'marble_run',
      lane: 'device',
      generatedAtMs: Date.parse('2026-07-07T10:00:00.000Z'),
      verdictPass: false,
      verdictScore: 45,
      verdictSummary: 'FAIL — panel median 45%',
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
      game: 'g', lane: 'device', generatedAt: '1970-01-01T00:00:08.000Z', verdict: { pass: false },
    }, 8000);
    const { newestChangeMs } = newestVisualChangeMs(['games/g/src/menu.ts'], dir);
    expect(evidenceIsFresh(newestChangeMs, readPanelEvidence(dir), ['g'])).toBe(true);
  });
  it('fresh-worktree simulation: clean file with fresh checkout mtime but old commit, panel between -> PASS', () => {
    write('games/g/src/menu.ts', Date.now()); // checkout stamped now
    writeJson('docs/evidence/2026-07-07-device-verify/panel.json', {
      game: 'g', lane: 'device', generatedAt: '2026-01-01T00:00:00.000Z', verdict: { pass: true },
    });
    const run = (cmd) => cmd.startsWith('git status')
      ? { ok: true, stdout: '' } // clean worktree
      : { ok: true, stdout: `${Math.floor(Date.parse('2025-01-01T00:00:00Z') / 1000)}\n` };
    const { newestChangeMs } = newestVisualChangeMs(['games/g/src/menu.ts'], dir, { run });
    expect(evidenceIsFresh(newestChangeMs, readPanelEvidence(dir), ['g'])).toBe(true);
  });
  it('dirty file in the same setup still FAILS (mtime newer than panel)', () => {
    write('games/g/src/menu.ts', Date.now());
    writeJson('docs/evidence/2026-07-07-device-verify/panel.json', {
      game: 'g', lane: 'device', generatedAt: '2026-01-01T00:00:00.000Z', verdict: { pass: true },
    });
    const run = (cmd) => cmd.startsWith('git status')
      ? { ok: true, stdout: ' M games/g/src/menu.ts\n' }
      : { ok: true, stdout: `${Math.floor(Date.parse('2025-01-01T00:00:00Z') / 1000)}\n` };
    const { newestChangeMs } = newestVisualChangeMs(['games/g/src/menu.ts'], dir, { run });
    expect(evidenceIsFresh(newestChangeMs, readPanelEvidence(dir), ['g'])).toBe(false);
  });
});
