// The UNVERIFIED ledger: append-only JSONL record of declared verification
// skips. Skipping stays possible (via the `UNVERIFIED:` marker) but is never
// silent — every skip lands here as {ts, changed_files, reason}.
import fs from 'node:fs';
import path from 'node:path';

export const LEDGER_PATH = '.work/verify-ledger.jsonl';

/**
 * Append one skip record. `now` is injectable for deterministic tests.
 * @returns {object} the record written
 */
export function appendLedgerEntry(ledgerFile, { changed_files, reason }, { fsImpl = fs, now } = {}) {
  const rec = {
    ts: now || new Date().toISOString(),
    changed_files: changed_files || [],
    reason: reason || '(no reason given)',
  };
  fsImpl.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  fsImpl.appendFileSync(ledgerFile, JSON.stringify(rec) + '\n');
  return rec;
}

/** Parse the ledger into records (skips blank/corrupt lines). [] if absent. */
export function readLedger(ledgerFile, fsImpl = fs) {
  let txt;
  try {
    txt = fsImpl.readFileSync(ledgerFile, 'utf8');
  } catch {
    return [];
  }
  return txt
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
