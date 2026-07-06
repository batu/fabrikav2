#!/usr/bin/env node
// tools/audit CLI — runs all guardrail linters against the repo and exits
// non-zero if any reports an ERROR (warnings are reported but non-failing).
// Wired into the root `audit` npm script and the `audit` CI job
// (matrix-independent).

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { repoRoot } from './lib.js';
import { lintNoLiterals } from './no-literals.js';
import { lintNoDuplication } from './no-duplication.js';
import { lintDepsDeclared } from './deps-declared.js';
import { lintStructure } from './structure.js';
import { lintHooks } from './hooks.js';

function fmtNoLiterals(v) {
  return `${v.file}:${v.line}  [${v.kind}]  ${JSON.stringify(v.value)}`;
}
function fmtNoDuplication(v) {
  if (v.kind === 'local') return `${v.file}  ${v.note}`;
  return `${v.file}  re-declares export "${v.name}" (owned by ${v.package})`;
}
function fmtDepsDeclared(v) {
  if (v.kind === 'unused') {
    return `${v.workspace}  declares ${v.import} but never imports it`;
  }
  return `${v.file}  imports ${v.import} — not declared in ${v.workspace}/package.json`;
}
function fmtStructure(v) {
  return `${v.game}/${v.entry} -> ${v.home}`;
}
function fmtHooks(v) {
  return `${v.file}  accepts an interaction option (onClick/onTap/onSelect) but exposes no data-fab-* hook`;
}

const LINTERS = [
  {
    name: 'no-literals',
    run: (root, allowlistPath) => lintNoLiterals(root, { allowlistPath }),
    fmt: fmtNoLiterals,
  },
  { name: 'no-duplication', run: (root) => lintNoDuplication(root), fmt: fmtNoDuplication },
  { name: 'deps-declared', run: (root) => lintDepsDeclared(root), fmt: fmtDepsDeclared },
  { name: 'structure', run: (root) => lintStructure(root), fmt: fmtStructure },
  { name: 'hooks', run: (root) => lintHooks(root), fmt: fmtHooks },
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
  let warned = false;

  // A violation is a WARNING when it carries `severity: 'warn'` (reported but
  // non-failing — e.g. sdk local-name dups and unused-declared deps, whose fixes
  // land outside this card's scope). Everything else is a hard error.
  for (const { name, fmt, violations } of results) {
    const errors = violations.filter((v) => v.severity !== 'warn');
    const warnings = violations.filter((v) => v.severity === 'warn');
    if (errors.length === 0 && warnings.length === 0) {
      console.log(`✓ ${name}: ok`);
      continue;
    }
    if (errors.length) {
      failed = true;
      console.log(`✗ ${name}: ${errors.length} error(s)`);
      for (const v of errors) console.log(`    ${fmt(v)}`);
    }
    if (warnings.length) {
      warned = true;
      console.log(`⚠ ${name}: ${warnings.length} warning(s)`);
      for (const v of warnings) console.log(`    ${fmt(v)}`);
    }
  }

  if (failed) {
    console.error('\naudit failed — see violations above.');
    process.exit(1);
  }
  console.log(warned ? '\naudit passed (with warnings — see above).' : '\naudit passed.');
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('cli.js')) {
  main();
}
