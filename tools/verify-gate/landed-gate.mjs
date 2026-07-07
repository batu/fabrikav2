#!/usr/bin/env node
// Atomic merge+cleanup landing guard CLI (card MjiISWBg). The conductor MUST
// call this AFTER merging a card branch and BEFORE `git worktree remove` /
// `git branch -d|-D`. It HARD-CHECKS that the branch's work is provably on the
// integration branch (main by default). Exit 0 = landed, safe to clean up;
// exit 1 = NOT landed (or a key artifact is missing) — do NOT delete anything.
//
//   node tools/verify-gate/landed-gate.mjs trello-<shortid>-<slug>
//   node tools/verify-gate/landed-gate.mjs --shortid <shortid>
//   node tools/verify-gate/landed-gate.mjs <branch> --onto main --artifact path/to/key
//
// --shortid <id>   locate the branch as 'trello-<id>-*' (never reconstruct it)
// --onto <ref>     integration ref the branch was merged into (default HEAD)
// --artifact <p>   also require <p> to exist on <ref> (repeatable)
//
// FAIL-CLOSED: any unexpected error is a hard exit 1 — a landing guard must
// never wave a delete through on error. Set LANDED_GATE_PROJECT_DIR to gate a
// different checkout.
import { execSync } from 'node:child_process';
import { evaluateLanded, locateBranch, parseArgs } from './src/landed.mjs';

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
  const projectDir = process.env.LANDED_GATE_PROJECT_DIR || process.cwd();
  const run = makeRunner(projectDir);
  const args = parseArgs(process.argv.slice(2));

  let branch = args.branch;
  if (branch === null) {
    const located = locateBranch(run, args.shortid);
    if (!located.ok) {
      process.stderr.write(`verify-landed-gate: FAIL — ${located.reason}\n`);
      return 1;
    }
    branch = located.branch;
  }

  const result = evaluateLanded({ run, branch, ontoRef: args.onto, artifacts: args.artifacts });
  if (result.ok) {
    process.stdout.write(`verify-landed-gate: PASS — ${result.reason}\n`);
    return 0;
  }
  process.stderr.write(
    `verify-landed-gate: FAIL — ${result.reason}\n`
    + '  Do NOT run `git worktree remove` / `git branch -d|-D` for this card.\n',
  );
  return 1;
}

try {
  process.exit(main());
} catch (err) {
  // Fail-closed: a broken landing guard must never authorise a branch delete.
  process.stderr.write(`verify-landed-gate: ERROR — ${err && err.message}\n`);
  process.exit(1);
}
