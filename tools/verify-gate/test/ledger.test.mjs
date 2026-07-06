import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendLedgerEntry, readLedger } from '../src/ledger.mjs';

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
