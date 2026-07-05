// Linter 2 — no-duplication.
//
// Guardrail #3: a game that re-implements something already published by a
// `packages/*` workspace fails the audit. v1's failure (research 04 §3): three
// games each rewrote a haptics module while `core/haptics` already existed.
//
// Mechanism (name-based, documented): we collect the PUBLIC export names of
// every `packages/*` workspace (the names exported from its entry file), then
// flag any `games/*` source file that DECLARES an export of the same name. A
// game re-exporting the shared symbol FROM the package (`export { x } from
// '@fabrikav2/sdk'`) is a re-use, not a duplication, and is not flagged.
//
// This is a heuristic proxy for "reimplemented the same thing": it catches
// exact-name collisions, which is how the shared-vs-local fork shows up once
// the shared name is the canonical one. Divergent local names (v1's `haptic`
// vs core's `safeImpact`) are the reason the shared surface must own the name;
// this linter enforces that once the package export exists, games don't shadow
// it.

import { join } from 'node:path';
import {
  walkFiles, readText, readJson, rel, listDirs, extractExportNames, SOURCE_EXTS,
} from './lib.js';

/** Entry source file for a package (its `main`, defaulting to src/index.ts). */
function entryFile(pkgDir) {
  const pkg = readJson(join(pkgDir, 'package.json'));
  const main = (pkg && pkg.main) || 'src/index.ts';
  return join(pkgDir, main);
}

/**
 * Map every public package export name -> the package that owns it.
 * @returns {Map<string,string>} name -> package name
 */
export function collectPackageExports(root) {
  const owners = new Map();
  for (const pkgDir of listDirs(join(root, 'packages'))) {
    const pkg = readJson(join(pkgDir, 'package.json'));
    const pkgName = (pkg && pkg.name) || rel(root, pkgDir);
    const text = readText(entryFile(pkgDir));
    for (const name of extractExportNames(text)) {
      if (!owners.has(name)) owners.set(name, pkgName);
    }
  }
  return owners;
}

/**
 * @param {string} root
 * @returns {{violations: Array<{file:string,name:string,package:string}>}}
 */
export function lintNoDuplication(root) {
  const owners = collectPackageExports(root);
  const violations = [];

  for (const gameDir of listDirs(join(root, 'games'))) {
    for (const file of walkFiles(gameDir, { exts: SOURCE_EXTS })) {
      const text = readText(file);
      // Re-exports sourced from a workspace package are re-uses; drop them.
      const declared = extractExportNames(text, { includeReExportsFromScope: false });
      for (const name of declared) {
        if (owners.has(name)) {
          violations.push({ file: rel(root, file), name, package: owners.get(name) });
        }
      }
    }
  }

  return { violations };
}
