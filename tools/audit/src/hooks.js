// Linter 5 — hooks (WARN-first).
//
// Guardrail: every interactive `packages/ui` component exposes a stable
// `data-fab-*` hook, so tests (and the testkit SharedShellDriver) can drive it
// with a REAL click through a selector — the dead-menu-buttons lesson
// (docs/retros/insitu-testing-capability-notes.md): a component that renders a
// clickable element with no stable hook can only be driven by `el.click()` /
// engine shortcuts, which is exactly how the dead-menu-buttons bug passed CI.
//
// HEURISTIC (CONDUCTOR decision 5, documented): a component source file that
// ACCEPTS an interaction callback option (`onClick` / `onTap` / `onSelect`) is
// interactive, and MUST thread a hook to its element — detected by the presence
// of any hook token (`data-fab`, `dataset.fab`, `dataAction`) in the same file.
// A file that accepts an interaction option but names no hook token is flagged.
//
// It is a STATIC name scan, not a DOM/reachability analysis, so it has known
// false positives (documented so they are not re-litigated):
//   - a pure CONTAINER that forwards an injected `onClick` to a child it does
//     not render (delegation) — but in this codebase such components reference
//     the child's hook option (`dataAction`) and so pass;
//   - a component whose only clickable is a composed hooked primitive — it
//     references that primitive's hook option and passes.
// Because of these, it is WARN-FIRST (`severity: 'warn'`): reported but
// non-failing, so coverage can land incrementally without breaking the gate
// (mirrors the no-duplication local-name warnings — tools/audit/src/cli.js:64).

import { join } from 'node:path';
import { walkFiles, readText, rel, stripComments, SOURCE_EXTS } from './lib.js';

// Files that are not components: the barrel and the shared internal helpers.
const NON_COMPONENT = new Set(['index.ts', 'internal.ts']);

const isTestFile = (relPath) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(relPath);

// An accepted interaction callback option marks the component as interactive.
const INTERACTION_RE = /\bon(?:Click|Tap|Select)\b/;
// Any stable-hook token satisfies the rule.
const HOOK_RE = /data-fab|dataset\.fab|\bdataAction\b/;

/**
 * @param {string} root
 * @returns {{violations: Array<{file:string, severity:'warn'}>}}
 */
export function lintHooks(root) {
  const violations = [];
  const uiSrc = join(root, 'packages', 'ui', 'src');

  for (const file of walkFiles(uiSrc, { exts: SOURCE_EXTS })) {
    const relPath = rel(root, file);
    const base = relPath.split('/').pop();
    if (isTestFile(relPath) || NON_COMPONENT.has(base)) continue;

    const text = stripComments(readText(file));
    if (!INTERACTION_RE.test(text)) continue; // not interactive → out of scope
    if (HOOK_RE.test(text)) continue; // interactive AND hooked → ok

    violations.push({ file: relPath, severity: 'warn' });
  }

  return { violations };
}
