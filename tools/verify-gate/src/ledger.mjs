// The UNVERIFIED ledger: append-only JSONL record of declared verification
// skips. Skipping stays possible (via the `UNVERIFIED:` marker) but is never
// silent — every skip lands here as {ts, changed_files, reason}.
import fs from 'node:fs';
import path from 'node:path';

export const LEDGER_PATH = '.work/verify-ledger.jsonl';

/**
 * Absolute ledger file path, resolved against the repository's MAIN checkout.
 * `.work/` is gitignored and workspace-local, so a ledger written inside a
 * linked worktree would be invisible to every other checkout; anchoring on the
 * parent of `git rev-parse --git-common-dir` gives all worktrees one shared
 * ledger. Fail-soft: no runner, git error, or empty output falls back to
 * projectDir (the pre-existing behavior — also the main-checkout/non-git case).
 * @param {string} projectDir
 * @param {(cmd:string)=>{ok:boolean, stdout:string}} [run]
 */
export function resolveLedgerFile(projectDir, run) {
  let root = projectDir;
  if (run) {
    try {
      const res = run('git rev-parse --git-common-dir');
      const common = res.ok ? res.stdout.trim() : '';
      if (common) {
        root = path.dirname(path.isAbsolute(common) ? common : path.resolve(projectDir, common));
      }
    } catch {
      // fail-soft: keep projectDir
    }
  }
  return path.join(root, LEDGER_PATH);
}

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
