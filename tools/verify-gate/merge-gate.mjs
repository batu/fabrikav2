#!/usr/bin/env node
// Merge/land gate (card elkcIthD, piece 3). The ship-time backstop for the
// UNVERIFIED escape hatch: a card whose diff touches visual globs HARD-FAILS
// (exit 1) when there is no fresh real panel.json covering the change — even if
// the ledger is full of UNVERIFIED entries. Self-disables (exit 0) when the
// verify-device tool or games/ dir are absent.
//
//   node tools/verify-gate/merge-gate.mjs            # gate the current diff
//
// FAIL-CLOSED (unlike the Stop hook): this runs at landing time, so an
// unexpected error is a hard fail, not a silent pass. Set VERIFY_GATE_PROJECT_DIR
// to gate a different checkout.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { decideMerge, isVisualFile } from './src/classify.mjs';
import { changedFilesVsMain } from './src/git.mjs';
import { newestVisualChangeMs, readPanelEvidence } from './src/evidence.mjs';
import { readLedger, LEDGER_PATH } from './src/ledger.mjs';

function makeRunner(cwd) {
  return (cmd) => {
    try {
      const stdout = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return { ok: true, stdout };
    } catch (e) {
      return { ok: false, stdout: e && e.stdout ? String(e.stdout) : '' };
    }
  };
}

function main() {
  const projectDir = process.env.VERIFY_GATE_PROJECT_DIR || process.cwd();

  const toolPresent = fs.existsSync(path.join(projectDir, 'tools/verify-device/cli.mjs'));
  let gamesDirPresent = false;
  try {
    gamesDirPresent = fs.statSync(path.join(projectDir, 'games')).isDirectory();
  } catch {
    gamesDirPresent = false;
  }

  const run = makeRunner(projectDir);
  const changed = changedFilesVsMain(run);
  if (!changed.ok) {
    throw new Error(`could not resolve changed files: ${changed.error}`);
  }
  const changedFiles = changed.files;
  const visualFiles = changedFiles.filter(isVisualFile);
  const { newestChangeMs } = newestVisualChangeMs(visualFiles, projectDir, { run });
  const panels = readPanelEvidence(projectDir);
  const ledger = readLedger(path.join(projectDir, LEDGER_PATH));

  const decision = decideMerge({
    changedFiles,
    newestVisualMtimeMs: newestChangeMs,
    panelEvidence: panels,
    ledgerEntryCount: ledger.length,
    toolPresent,
    gamesDirPresent,
  });

  if (decision.ok) {
    process.stdout.write(`verify-merge-gate: PASS — ${decision.reason}\n`);
    return 0;
  }
  process.stderr.write(
    `verify-merge-gate: FAIL — ${decision.reason}\n`
    + decision.visualFiles.map((f) => `  - ${f}`).join('\n') + '\n'
    + `  Run: npm run verify-device -- --game <game>  (produces the panel.json this gate requires)\n`,
  );
  return 1;
}

try {
  process.exit(main());
} catch (err) {
  // Fail-closed: a broken landing gate must not wave a visual change through.
  process.stderr.write(`verify-merge-gate: ERROR — ${err && err.message}\n`);
  process.exit(1);
}
