#!/usr/bin/env node
// CLI for the project quality merge gate (card Lg56R10n). Reads the
// `project_gate` block from agents/config.json (falling back to historical
// `twf_gate`) and runs `pre` then `cmds`, failing closed on the first non-zero
// command so a broken build/test/audit blocks the land.
//
//   node tools/verify-gate/project-gate.mjs      # gate this repo
//
// Set PROJECT_GATE_DIR to gate a different checkout. FAIL-CLOSED: any
// unexpected error exits 1 — a landing gate must never wave a change through
// on error.
import { runGate, configFileFor, makeRunner } from './src/project-gate.mjs';

try {
  const projectDir = process.env.PROJECT_GATE_DIR || process.cwd();
  const configFile = configFileFor(projectDir);
  const result = runGate({
    configFile,
    runner: makeRunner(projectDir),
    log: (m) => process.stdout.write(m + '\n'),
  });
  if (result.ok) {
    process.stdout.write(`project-gate: PASS — ${result.commands.length} command(s) green\n`);
    process.exit(0);
  }
  process.stderr.write(
    `project-gate: FAIL — \`${result.failed}\` exited ${result.code}. `
    + 'Merge blocked; fix and re-run.\n',
  );
  process.exit(1);
} catch (err) {
  process.stderr.write(`project-gate: ERROR — ${err && err.message}\n`);
  process.exit(1);
}
