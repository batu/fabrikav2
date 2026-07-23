import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendLedgerEntry, readLedger, resolveLedgerFile, LEDGER_PATH } from '../src/ledger.mjs';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-gate-ledger-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('appendLedgerEntry + readLedger (real fs, temp dir)', () => {
  it('creates the .work dir and appends a well-formed JSONL record', () => {
    const ledger = path.join(dir, '.work', 'verify-ledger.jsonl');
    const rec = appendLedgerEntry(
      ledger,
      { changed_files: ['games/marble_run/src/menu.ts'], reason: 'no device' },
      { now: '2026-07-07T00:00:00.000Z' },
    );
    expect(rec).toEqual({
      ts: '2026-07-07T00:00:00.000Z',
      changed_files: ['games/marble_run/src/menu.ts'],
      reason: 'no device',
    });
    const parsed = readLedger(ledger);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(rec);
  });

  it('appends (does not overwrite) across calls', () => {
    const ledger = path.join(dir, '.work', 'verify-ledger.jsonl');
    appendLedgerEntry(ledger, { changed_files: ['a'], reason: 'r1' }, { now: 't1' });
    appendLedgerEntry(ledger, { changed_files: ['b'], reason: 'r2' }, { now: 't2' });
    const parsed = readLedger(ledger);
    expect(parsed.map((r) => r.reason)).toEqual(['r1', 'r2']);
  });

  it('readLedger returns [] for a missing file and skips corrupt lines', () => {
    const ledger = path.join(dir, 'nope.jsonl');
    expect(readLedger(ledger)).toEqual([]);
    fs.writeFileSync(ledger, '{"ts":"t","changed_files":[],"reason":"ok"}\nGARBAGE\n\n');
    expect(readLedger(ledger)).toHaveLength(1);
  });
});

describe('resolveLedgerFile (worktree-shared .work root)', () => {
  it('resolves to the main checkout when projectDir is a linked worktree', () => {
    const run = () => ({ ok: true, stdout: '/repo/main/.git\n' });
    expect(resolveLedgerFile('/repo/wt/agent-x', run)).toBe(path.join('/repo/main', LEDGER_PATH));
  });

  it('falls back to projectDir in the main checkout (relative .git)', () => {
    const run = () => ({ ok: true, stdout: '.git\n' });
    expect(resolveLedgerFile('/repo/main', run)).toBe(path.join('/repo/main', LEDGER_PATH));
  });

  it('falls back to projectDir when not a git repo or git errors', () => {
    expect(resolveLedgerFile('/some/dir', () => ({ ok: false, stdout: '' })))
      .toBe(path.join('/some/dir', LEDGER_PATH));
    expect(resolveLedgerFile('/some/dir', () => { throw new Error('boom'); }))
      .toBe(path.join('/some/dir', LEDGER_PATH));
    expect(resolveLedgerFile('/some/dir')).toBe(path.join('/some/dir', LEDGER_PATH));
  });
});
