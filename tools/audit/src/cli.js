#!/usr/bin/env node
// tools/audit CLI — runs all three guardrail linters against the repo and exits
// non-zero if any reports a violation. Wired into the root `audit` npm script
// and the `audit` CI job (matrix-independent).

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { repoRoot } from './lib.js';
import { lintNoLiterals } from './no-literals.js';
import { lintNoDuplication } from './no-duplication.js';
import { lintDepsDeclared } from './deps-declared.js';

function fmtNoLiterals(v) {
  return `${v.file}:${v.line}  [${v.kind}]  ${JSON.stringify(v.value)}`;
}
function fmtNoDuplication(v) {
  return `${v.file}  re-declares export "${v.name}" (owned by ${v.package})`;
}
function fmtDepsDeclared(v) {
  return `${v.file}  imports ${v.import} — not declared in ${v.workspace}/package.json`;
}

const LINTERS = [
  {
    name: 'no-literals',
    run: (root, allowlistPath) => lintNoLiterals(root, { allowlistPath }),
    fmt: fmtNoLiterals,
  },
  { name: 'no-duplication', run: (root) => lintNoDuplication(root), fmt: fmtNoDuplication },
  { name: 'deps-declared', run: (root) => lintDepsDeclared(root), fmt: fmtDepsDeclared },
];

export function runAll(root, { allowlistPath } = {}) {
  const results = [];
  for (const linter of LINTERS) {
    const { violations } = linter.run(root, allowlistPath);
    results.push({ name: linter.name, fmt: linter.fmt, violations });
  }
  return results;
}

function main() {
  const root = repoRoot();
  const defaultAllowlist = join(root, 'tools', 'audit', 'allowlist.json');
  const allowlistPath = existsSync(defaultAllowlist) ? defaultAllowlist : undefined;

  const results = runAll(root, { allowlistPath });
  let failed = false;

  for (const { name, fmt, violations } of results) {
    if (violations.length === 0) {
      console.log(`✓ ${name}: ok`);
      continue;
    }
    failed = true;
    console.log(`✗ ${name}: ${violations.length} violation(s)`);
    for (const v of violations) console.log(`    ${fmt(v)}`);
  }

  if (failed) {
    console.error('\naudit failed — see violations above.');
    process.exit(1);
  }
  console.log('\naudit passed.');
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('cli.js')) {
  main();
}
