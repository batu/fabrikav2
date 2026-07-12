#!/usr/bin/env node
// Claim-gated verify Stop-hook (card elkcIthD, piece 1 + 2). Reads the Claude
// Code Stop-hook JSON on stdin, inspects the last assistant message + the diff +
// the evidence on disk, and either:
//   • BLOCKS (prints {"decision":"block","reason":...}) when a done-claim touches
//     visual files with no fresh verify-device evidence and no UNVERIFIED marker;
//   • records the skip to .work/verify-ledger.jsonl when an UNVERIFIED marker is
//     present (never blocks);
//   • does nothing otherwise.
//
// FAIL-OPEN by design: any unexpected error exits 0 (no block). A broken
// enforcement hook must never wedge every turn — the merge gate is the
// ship-time backstop. Self-disable is handled both here and in the shell shim.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { decideStop, buildBlockMessage, isVisualFile } from './src/classify.mjs';
import { changedFilesVsMain } from './src/git.mjs';
import { newestVisualChangeMs, readPanelEvidence } from './src/evidence.mjs';
import { readObservationEvidence } from './src/observation-evidence.mjs';
import { readLastAssistantText } from './src/transcript.mjs';
import { appendLedgerEntry, LEDGER_PATH } from './src/ledger.mjs';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

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
  let input = {};
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    input = {};
  }
  const projectDir = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Self-disable: no verify-device tool or no games/ dir -> no-op (catalog-safe
  // for non-game projects).
  const toolPresent = fs.existsSync(path.join(projectDir, 'tools/verify-device/cli.mjs'));
  let gamesDirPresent = false;
  try {
    gamesDirPresent = fs.statSync(path.join(projectDir, 'games')).isDirectory();
  } catch {
    gamesDirPresent = false;
  }
  if (!toolPresent || !gamesDirPresent) return 0;

  const message = readLastAssistantText(input.transcript_path);
  const run = makeRunner(projectDir);
  const changed = changedFilesVsMain(run);
  if (!changed.ok) return 0; // fail-open: merge-gate is the fail-closed backstop
  const changedFiles = changed.files;
  const visualFiles = changedFiles.filter(isVisualFile);
  const { newestChangeMs } = newestVisualChangeMs(visualFiles, projectDir, { run });
  const panels = readPanelEvidence(projectDir);
  const observations = readObservationEvidence(projectDir);

  const decision = decideStop({
    message,
    changedFiles,
    newestVisualMtimeMs: newestChangeMs,
    panelEvidence: panels,
    observationEvidence: observations,
    toolPresent,
    gamesDirPresent,
  });

  if (decision.action === 'ledger') {
    appendLedgerEntry(
      path.join(projectDir, LEDGER_PATH),
      { changed_files: decision.visualFiles, reason: decision.ledgerReason },
    );
    return 0;
  }
  if (decision.action === 'block') {
    process.stdout.write(
      JSON.stringify({ decision: 'block', reason: buildBlockMessage(decision) }) + '\n',
    );
    return 0;
  }
  return 0; // pass / noop
}

try {
  process.exit(main());
} catch {
  process.exit(0); // fail-open: never wedge the turn
}
