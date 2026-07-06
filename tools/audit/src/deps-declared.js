// Linter 3 — deps-declared.
//
// Guardrail #1: no phantom `@fabrikav2/*` imports. A workspace that imports a
// sibling package must DECLARE it in its own package.json. v1's failure
// (research 06 §1): three of four games imported `@fabrika/core` without
// declaring it, resolved only by npm's node_modules hoist — invisible until a
// hoist change broke it silently.
//
// v1's safety net (scripts/grep-affected-games.sh) was broken because it only
// matched double-quoted imports while every game used single quotes (research
// 06 §3). This linter matches BOTH quote styles — that specific bug is covered
// by a regression fixture.
//
// It also runs the INVERSE check (research 10 finding 10): a declared
// `@fabrikav2/*` dep with zero imports anywhere in the workspace is a WARNING
// (not a gate failure). Test-file imports count as usage.

import { join } from 'node:path';
import {
  walkFiles, readText, readJson, rel, listWorkspaces, stripComments,
  SCOPE, SOURCE_EXTS,
} from './lib.js';

// Matches import/require/dynamic-import of a scoped package in either quote
// style. Captures the bare package name (scope + first segment), ignoring any
// deep subpath. Runs against comment-stripped text (strings are preserved).
const IMPORT_RE = new RegExp(
  `(?:from|import|require)\\s*\\(?\\s*(['"])(${SCOPE}\\/[\\w.-]+)(?:\\/[^'"]*)?\\1`,
  'g',
);

/** All declared dependency names across the four dependency buckets. */
function declaredDeps(pkg) {
  const buckets = [
    'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies',
  ];
  const names = new Set();
  for (const b of buckets) {
    if (pkg && pkg[b]) for (const name of Object.keys(pkg[b])) names.add(name);
  }
  return names;
}

/**
 * @param {string} root
 * @returns {{violations: Array<{workspace:string,file:string,import:string}>}}
 */
export function lintDepsDeclared(root) {
  const violations = [];

  for (const wsDir of listWorkspaces(root)) {
    const pkg = readJson(join(wsDir, 'package.json'));
    const wsName = (pkg && pkg.name) || rel(root, wsDir);
    const declared = declaredDeps(pkg);
    const seen = new Set();
    const used = new Set();

    for (const file of walkFiles(wsDir, { exts: SOURCE_EXTS })) {
      const text = stripComments(readText(file));
      for (const m of text.matchAll(IMPORT_RE)) {
        const imported = m[2]; // e.g. @fabrikav2/kernel
        used.add(imported);
        if (imported === wsName) continue; // self-import (rare) is not phantom
        if (declared.has(imported)) continue;
        const key = `${file}::${imported}`;
        if (seen.has(key)) continue;
        seen.add(key);
        violations.push({ workspace: wsName, file: rel(root, file), import: imported });
      }
    }

    // Inverse check (research 10 finding 10): a declared `@fabrikav2/*` dep that
    // is never imported anywhere in the workspace. WARN, not error — a dead
    // workspace dep is a smell, not the build hazard a phantom import is.
    // Test-file imports COUNT (the walk includes colocated `*.test.ts`): a dep
    // used only in tests is correctly "used" (this is why packages/ui's kernel
    // devDep, imported in *.test.ts via @fabrikav2/kernel/flow, does NOT warn).
    for (const dep of declared) {
      if (!dep.startsWith(SCOPE)) continue; // only sibling @fabrikav2/* deps
      if (dep === wsName) continue;
      if (used.has(dep)) continue;
      violations.push({ workspace: wsName, import: dep, kind: 'unused', severity: 'warn' });
    }
  }

  return { violations };
}
