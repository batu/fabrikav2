#!/usr/bin/env node
// U1 freeze-record gate CLI (card qWCv9tUo freeze tail). The narrow, executable
// verifier that the dual-design-frontends comparison baseline is honestly
// SEALED before U5/U6 inherit a frozen comparison epoch. It:
//   - reads experiments/design-frontends/protocol.json,
//   - recomputes the NON-CIRCULAR canonical hashes of the protocol payload,
//     fences.json, and every baseline/* file,
//   - queries git for the recorded freeze.baselineCommit, and
//   - fails closed on a null commit, a commit not present / not an ancestor of
//     HEAD, a hash mismatch, or a missing/extra frozen file.
//
//   node tools/verify-gate/freeze-gate.mjs            # gate this repo
//
// SELF-DISABLING: exits 0 with a SKIP note when there is no
// experiments/design-frontends/protocol.json (e.g. on main / non-experiment
// branches) — the same no-op-when-absent pattern the other gates use.
//
// FAIL-CLOSED: any unexpected error exits 1 — a freeze gate must never seal a
// baseline it could not fully verify. Set FREEZE_GATE_PROJECT_DIR to gate a
// different checkout.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  FENCES_FILE,
  PROTOCOL_FILE,
  BASELINE_DIR,
  COMMIT_RE,
  hashBytes,
  hashProtocolPayload,
  verifyFreeze,
} from './src/freeze.mjs';

export const EXPERIMENT_ROOT = 'experiments/design-frontends';

/** Recursively list files under `dir`, returned as paths relative to `dir`. */
function listFilesRecursive(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFilesRecursive(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

/**
 * Recompute the actual hash of every frozen file present on disk under `root`.
 * protocol.json is hashed as its freeze-excluded canonical payload; fences.json
 * and every baseline/* file are hashed over exact bytes. Keys are POSIX-style
 * relative paths matching the freeze record.
 */
export function gatherActualHashes(root) {
  const actual = {};
  const protocolPath = path.join(root, PROTOCOL_FILE);
  if (fs.existsSync(protocolPath)) {
    actual[PROTOCOL_FILE] = hashProtocolPayload(fs.readFileSync(protocolPath, 'utf8'));
  }
  const fencesPath = path.join(root, FENCES_FILE);
  if (fs.existsSync(fencesPath)) {
    actual[FENCES_FILE] = hashBytes(fs.readFileSync(fencesPath));
  }
  const baselineDir = path.join(root, BASELINE_DIR);
  if (fs.existsSync(baselineDir)) {
    for (const rel of listFilesRecursive(baselineDir)) {
      const posix = `${BASELINE_DIR}/${rel.split(path.sep).join('/')}`;
      actual[posix] = hashBytes(fs.readFileSync(path.join(baselineDir, rel)));
    }
  }
  return actual;
}

/** git command runner scoped to `cwd`; { ok } reflects the exit status. */
function makeRunner(cwd) {
  return (cmd) => {
    try {
      execSync(cmd, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  };
}

/**
 * git facts for a candidate baseline commit: is the object present, and is it
 * an ancestor of HEAD (an appropriate, in-history baseline)? Returns null for a
 * malformed SHA so the pure verifier reports the format error instead.
 */
export function gitCommitFacts(run, sha) {
  if (typeof sha !== 'string' || !COMMIT_RE.test(sha)) return null;
  const present = run(`git cat-file -e ${sha}^{commit}`).ok;
  const inHistory = present && run(`git merge-base --is-ancestor ${sha} HEAD`).ok;
  return { present, inHistory };
}

function main() {
  const projectDir = process.env.FREEZE_GATE_PROJECT_DIR || process.cwd();
  const root = path.join(projectDir, EXPERIMENT_ROOT);
  const protocolPath = path.join(root, PROTOCOL_FILE);

  if (!fs.existsSync(protocolPath)) {
    process.stdout.write(
      `freeze-gate: SKIP — no ${EXPERIMENT_ROOT}/${PROTOCOL_FILE} (nothing to seal)\n`,
    );
    return 0;
  }

  const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'));
  const freeze = protocol && protocol.freeze;
  const actualHashes = gatherActualHashes(root);
  const run = makeRunner(projectDir);
  const commit = gitCommitFacts(run, freeze && freeze.baselineCommit);

  const result = verifyFreeze({ freeze, actualHashes, commit });
  if (result.ok) {
    process.stdout.write(
      `freeze-gate: PASS — baseline ${freeze.baselineCommit} sealed; `
      + `${Object.keys(actualHashes).length} frozen file(s) hash-verified\n`,
    );
    return 0;
  }
  process.stderr.write('freeze-gate: FAIL — the U1 freeze record is not honestly sealed:\n');
  for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
  return 1;
}

// Only run the gate when invoked directly; stay importable for tests and the
// hash-compute helper above.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exit(main());
  } catch (err) {
    process.stderr.write(`freeze-gate: ERROR — ${err && err.message}\n`);
    process.exit(1);
  }
}
