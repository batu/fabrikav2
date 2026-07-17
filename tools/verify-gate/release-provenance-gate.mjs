#!/usr/bin/env node
// CLI for the release provenance gate — run before ANY store build/sign/upload:
//
//   node tools/verify-gate/release-provenance-gate.mjs   # gate this checkout
//
// Set RELEASE_GATE_DIR to gate a different checkout. Exits non-zero when the
// working tree is dirty or HEAD is unpushed, so a release pipeline that chains
// on `&&` refuses to sign/upload an untraceable bundle (the FTD 1.0.2 lesson).
import { execSync } from 'node:child_process';
import { checkReleaseProvenance } from './src/release-provenance.mjs';

const dir = process.env.RELEASE_GATE_DIR || process.cwd();

function run(cmd) {
  try {
    return { ok: true, stdout: execSync(cmd, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() };
  } catch {
    return { ok: false, stdout: '' };
  }
}

try {
  const result = checkReleaseProvenance(run);
  if (result.ok) {
    process.stdout.write(`release-provenance-gate: PASS — HEAD ${result.sha.slice(0, 10)} is clean and pushed\n`);
    process.exit(0);
  }
  for (const failure of result.failures) {
    process.stderr.write(`release-provenance-gate: FAIL — ${failure}\n`);
  }
  process.exit(1);
} catch (err) {
  process.stderr.write(`release-provenance-gate: ERROR — ${err && err.message}\n`);
  process.exit(1);
}
