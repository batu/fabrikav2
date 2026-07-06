// Linter 2 — no-duplication.
//
// Guardrail #3: something already published by a `packages/*` workspace must
// not be re-implemented. v1's failure (research 04 §3): three games each rewrote
// a haptics module while `core/haptics` already existed.
//
// THREE name-based checks (research 10 findings 2 & 3 hardened the first two
// blind spots — the linter used to walk games/* only, so package-vs-package and
// package-internal forks were structurally invisible, which is exactly how the
// withTimeout-×2 fork survived):
//
//   1. game re-declares a package export  (ERROR, original check) — a `games/*`
//      file DECLARING an export whose name a `packages/*` workspace already owns.
//   2. cross-package export collision  (ERROR, finding 3) — a `packages/*` entry
//      DECLARING an export name another `packages/*` entry already exports.
//   3. packages/sdk local-name duplication  (WARN, finding 2) — a LOCAL function
//      re-implementation that shadows a shared sdk export, or the same local
//      function name copied across sdk files. WARN (not gate-fail) because the
//      fix edits sdk source / a divergent contract, outside this audit card's
//      blast radius — report + promote (research 10 finding 2 / R4).
//
// Re-export allowance (all checks): a symbol re-exported FROM a workspace
// package (`export { x } from '@fabrikav2/sdk'`) is a re-use, not a duplication,
// and is dropped via `includeReExportsFromScope: false`.
//
// Name-based, and DOCUMENTED as such: it catches exact-name collisions, the
// shape the shared-vs-local fork takes once the shared name is canonical.
// Divergent local names (v1's `haptic` vs core's `safeImpact`) are the reason
// the shared surface must own the name; this linter enforces that once the
// export exists, nothing else shadows it. LIMIT (documented): a package whose
// entry is a pure `export *` barrel contributes no NAMED exports to check 2, so
// cross-package collision is measured at the direct-named-export level (the same
// entry-export basis check 1 already uses), not through transitive barrels.

import { join } from 'node:path';
import {
  walkFiles, readText, readJson, rel, listDirs, extractExportNames,
  extractLocalFunctionNames, SOURCE_EXTS,
} from './lib.js';

/** Entry source file for a package (its `main`, defaulting to src/index.ts). */
function entryFile(pkgDir) {
  const pkg = readJson(join(pkgDir, 'package.json'));
  const main = (pkg && pkg.main) || 'src/index.ts';
  return join(pkgDir, main);
}

// Generic local names never worth flagging in the sdk local-name scan: common
// helper/mock identifiers that collide legitimately. Kept intentionally tiny and
// documented (conductor Q3); the real hits today are all specific names.
const LOCAL_NAME_ALLOWLIST = new Set(['noop', 'identity', 'assert', 'clamp', 'id']);

const isTestFile = (relPath) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(relPath);
const isDts = (relPath) => relPath.endsWith('.d.ts');

/**
 * Map every public package export name -> the package that owns it (check 1).
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
 * Check 2 — a packages/* entry declaring an export name another packages/* entry
 * already exports. Re-exports FROM a @fabrikav2 package are re-use, not
 * duplication (dropped via includeReExportsFromScope:false).
 */
function lintCrossPackage(root) {
  const violations = [];
  const owner = new Map(); // name -> pkgName of first declarer
  for (const pkgDir of listDirs(join(root, 'packages'))) {
    const pkg = readJson(join(pkgDir, 'package.json'));
    const pkgName = (pkg && pkg.name) || rel(root, pkgDir);
    const entryRel = rel(root, entryFile(pkgDir));
    const names = extractExportNames(readText(entryFile(pkgDir)), {
      includeReExportsFromScope: false,
    });
    for (const name of names) {
      if (owner.has(name) && owner.get(name) !== pkgName) {
        violations.push({ file: entryRel, name, package: owner.get(name), kind: 'cross' });
      } else if (!owner.has(name)) {
        owner.set(name, pkgName);
      }
    }
  }
  return violations;
}

/**
 * Check 3 — packages/sdk local-name duplication (WARN). Scoped to packages/sdk
 * (conductor Q2). Production files only: `*.test.ts` locals (mocks/helpers) and
 * `*.d.ts` ambient declarations are excluded from BOTH the local set and the
 * shared-export surface — a test mock shadowing, or an ambient type name, is not
 * the divergent-runtime footgun. Two signals:
 *   (a) a local function shadowing a name EXPORTED elsewhere in sdk (withTimeout)
 *   (b) the same local function name declared in 2+ sdk files (copy-pasted helper)
 */
function lintSdkLocalNames(root) {
  const sdkDir = join(root, 'packages', 'sdk');
  const violations = [];
  const exportedIn = new Map(); // name -> relPath (shared export surface)
  const localsIn = new Map();   // name -> [relPath, ...]

  for (const file of walkFiles(sdkDir, { exts: SOURCE_EXTS })) {
    const relPath = rel(root, file);
    if (isDts(relPath) || isTestFile(relPath)) continue;
    const text = readText(file);
    for (const name of extractExportNames(text)) {
      if (!exportedIn.has(name)) exportedIn.set(name, relPath);
    }
    for (const name of extractLocalFunctionNames(text)) {
      if (LOCAL_NAME_ALLOWLIST.has(name)) continue;
      if (!localsIn.has(name)) localsIn.set(name, []);
      localsIn.get(name).push(relPath);
    }
  }

  for (const [name, files] of localsIn) {
    const exportedAt = exportedIn.get(name);
    if (exportedAt) {
      // (a) local(s) shadowing a shared export declared in a different file.
      for (const f of files) {
        if (f === exportedAt) continue;
        violations.push({
          file: f, name, kind: 'local', severity: 'warn',
          note: `local "${name}" duplicates sdk export "${name}" from ${exportedAt}`,
        });
      }
    } else {
      // (b) same local function name copied across ≥2 sdk files.
      const uniq = [...new Set(files)];
      if (uniq.length > 1) {
        violations.push({
          file: uniq[0], name, kind: 'local', severity: 'warn',
          note: `local "${name}" is duplicated across sdk files: ${uniq.join(', ')}`,
        });
      }
    }
  }
  return violations;
}

/**
 * @param {string} root
 * @returns {{violations: Array<object>}}
 */
export function lintNoDuplication(root) {
  const owners = collectPackageExports(root);
  const violations = [];

  // Check 1 — a game re-declaring a package export name.
  for (const gameDir of listDirs(join(root, 'games'))) {
    for (const file of walkFiles(gameDir, { exts: SOURCE_EXTS })) {
      const text = readText(file);
      // Re-exports sourced from a workspace package are re-uses; drop them.
      const declared = extractExportNames(text, { includeReExportsFromScope: false });
      for (const name of declared) {
        if (owners.has(name)) {
          violations.push({ file: rel(root, file), name, package: owners.get(name), kind: 'cross' });
        }
      }
    }
  }

  // Check 2 — package ↔ package export collision.
  violations.push(...lintCrossPackage(root));

  // Check 3 — packages/sdk local-name duplication (WARN).
  violations.push(...lintSdkLocalNames(root));

  return { violations };
}
