// Linter 6 — harness (WARN-first).
//
// Guardrail: every game ships the REQUIRED debug harness
// (docs/architecture/reference-fidelity-harness.md 'REQUIRED debug harness per
// game'; docs/retros/harness-ledger.md). Batu hard expectation: a game is
// deterministically DRIVABLE and CAPTURABLE — a driver reads STATE and issues
// ACTIONS instead of eyeballing a screenshot and sampling a guess. A game
// missing the harness is exactly why the third-party android reference could not
// be auto-driven (no state, no solver — see the ledger).
//
// HEURISTIC (documented so it is not re-litigated): a "harness-bearing" source
// file in a game is one that IMPORTS the portfolio contract module
// (`@fabrikav2/testkit/harness`). Across a game's harness-bearing files
// (comment-stripped, so only real code — not prose mentions — counts) the
// aggregate MUST reference the REQUIRED surface:
//   - STATE    : `snapshot`  — the queryable fingerprint (scene+status+inputReady).
//   - ACTION/1 : `verbs`     — the typed primitive semantic-verb extension point.
//   - ACTION/2 : a solver-bound WIN goal verb — `winLevel` OR the legacy `autoWin`.
//   - ACTION/2 : a solver-bound FAIL goal verb — `failLevel` OR legacy `autoFail`.
// The canonical names are `winLevel`/`failLevel` (what games/_template scaffolds
// and new games write); `autoWin`/`autoFail` are accepted as ALIASES because the
// reference impl marble_run predates the portfolio rename (App.ts) and MUST NOT be
// edited by this card — the doc itself equates them ("winLevel() (autoWin)").
//
// PASSING FIXTURES: games/_template (scaffolds the whole surface) and
// games/marble_run (the reference the contract was generalized from). FAILS: a
// game whose harness is missing a required member (e.g. no winLevel/autoWin).
//
// It is a STATIC token scan (like the hooks linter), not a type/reachability
// analysis, so it verifies the SURFACE is present, not that each member is
// correctly wired — the TS contract (`@fabrikav2/testkit/harness`) owns typing and
// diff review owns wiring. Because it is a heuristic it is WARN-FIRST
// (`severity: 'warn'`): reported but non-failing, so coverage lands incrementally
// without breaking the gate (mirrors the hooks linter — tools/audit/src/cli.js).

import { join } from 'node:path';
import { listDirs, walkFiles, readText, rel, stripComments, SCOPE, SOURCE_EXTS } from './lib.js';

/** The portfolio harness-contract module a harness-bearing file imports. */
const HARNESS_MODULE = `${SCOPE}/testkit/harness`;

/**
 * The REQUIRED harness members, each with the token(s) that satisfy it. A member
 * is satisfied when its regex matches anywhere in the game's aggregated,
 * comment-stripped harness source. `winGoal`/`failGoal` accept the canonical name
 * or the marble_run legacy alias (see header).
 */
const REQUIRED = [
  { label: 'snapshot() [STATE]', re: /\bsnapshot\b/ },
  { label: 'verbs [primitive ACTION verbs]', re: /\bverbs\b/ },
  { label: 'winLevel()/autoWin() [solver-bound WIN goal]', re: /\b(?:winLevel|autoWin)\b/ },
  { label: 'failLevel()/autoFail() [solver-bound FAIL goal]', re: /\b(?:failLevel|autoFail)\b/ },
];

/**
 * @param {string} root
 * @returns {{violations: Array<{game:string, missing:string[], severity:'warn'}>}}
 */
export function lintHarness(root) {
  const violations = [];

  for (const gameDir of listDirs(join(root, 'games'))) {
    const game = rel(root, gameDir);
    const srcFiles = walkFiles(join(gameDir, 'src'), { exts: SOURCE_EXTS });

    // Harness-bearing files: those importing the portfolio contract module.
    const harnessFiles = srcFiles.filter((f) => readText(f).includes(HARNESS_MODULE));
    if (harnessFiles.length === 0) {
      violations.push({
        game,
        missing: [`(no harness — no file imports ${HARNESS_MODULE})`],
        severity: 'warn',
      });
      continue;
    }

    // Aggregate comment-stripped code across the game's harness files, then check
    // each REQUIRED member is referenced somewhere in it.
    const blob = harnessFiles.map((f) => stripComments(readText(f))).join('\n');
    const missing = REQUIRED.filter((r) => !r.re.test(blob)).map((r) => r.label);
    if (missing.length) violations.push({ game, missing, severity: 'warn' });
  }

  return { violations };
}
