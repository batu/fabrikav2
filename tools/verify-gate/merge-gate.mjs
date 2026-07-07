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
import { changedFilesVsMain, dirtyFiles } from './src/git.mjs';
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

function splitLabels(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to comma/semicolon splitting.
    }
  }
  return raw.split(/[;,]/).map((label) => label.trim()).filter(Boolean);
}

function readCardContext() {
  return {
    cardTitle: process.env.VERIFY_GATE_CARD_TITLE || process.env.TWF_CARD_TITLE || '',
    cardLabels: splitLabels(process.env.VERIFY_GATE_CARD_LABELS || process.env.TWF_CARD_LABELS || ''),
  };
}

function decisionFiles(decision) {
  return decision.dirtyFiles || decision.docsOnlyFiles || decision.visualFiles || [];
}

function decisionHint(decision) {
  if (decision.dirtyFiles) {
    return '  Fix: return to the worker branch/worktree and commit or discard these changes; do not conductor-commit worker output.\n';
  }
  if (decision.docsOnlyFiles) {
    return '  Fix: add the implementation diff, or make the card explicitly doc/research/spike-exempt by label or title prefix.\n';
  }
  return '  Run: npm run verify-device -- --game <game>  (produces the panel.json this gate requires)\n';
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
  const dirty = dirtyFiles(run);
  if (!dirty.ok) {
    throw new Error(`could not resolve worktree status: ${dirty.error}`);
  }
  const changed = changedFilesVsMain(run);
  if (!changed.ok) {
    throw new Error(`could not resolve changed files: ${changed.error}`);
  }
  const changedFiles = changed.files;
  const visualFiles = changedFiles.filter(isVisualFile);
  const { newestChangeMs } = newestVisualChangeMs(visualFiles, projectDir, { run });
  const panels = readPanelEvidence(projectDir);
  const ledger = readLedger(path.join(projectDir, LEDGER_PATH));
  const cardContext = readCardContext();

  const decision = decideMerge({
    changedFiles,
    newestVisualMtimeMs: newestChangeMs,
    panelEvidence: panels,
    ledgerEntryCount: ledger.length,
    worktreeDirtyFiles: dirty.files,
    cardTitle: cardContext.cardTitle,
    cardLabels: cardContext.cardLabels,
    toolPresent,
    gamesDirPresent,
  });

  if (decision.ok) {
    process.stdout.write(`verify-merge-gate: PASS — ${decision.reason}\n`);
    return 0;
  }
  const files = decisionFiles(decision);
  process.stderr.write(
    `verify-merge-gate: FAIL — ${decision.reason}\n`
    + (files.length ? files.map((f) => `  - ${f}`).join('\n') + '\n' : '')
    + decisionHint(decision),
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
