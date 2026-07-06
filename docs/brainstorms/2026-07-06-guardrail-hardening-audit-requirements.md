---
title: "Guardrail hardening — package-level duplication scan, live eslint, config copy scope, unused-declared deps requirements"
date: 2026-07-06
trello: https://trello.com/c/a7iHWbkz
card: a7iHWbkz
stage: todo → brainstormed
status: requirements-locked
source: docs/research/10-integration-review-midnight.md (findings 3, 4, 9, 10) + CONDUCTOR item 0
---

# Guardrail hardening: audit linters — requirements & approach

Requirements/approach artifact for the `todo → brainstormed` transition. This card
hardens the `tools/audit` guardrails that "went blind" per the integration review,
plus a conductor-added item 0 (native shells). Every guardrail here already exists
and passes today; the work is **extending detection**, not building new machinery.
No code is written at this stage.

The high-value move of this doc is re-grounding each item against the **current
repo** (HEAD `a33dfe3`), because the integration review (`10-integration-review-midnight.md`)
was written earlier and several of its premises have since shifted. Where a premise
is stale, this doc flags it as a **true-positive-vs-false-positive** decision the
`worked` stage must make deliberately, so it does not "fix" a violation the repo
has already resolved.

## Goal

Extend the four `tools/audit` linters (`no-duplication`, `no-literals`,
`deps-declared`, `structure`) so the specific evasion paths the integration review
found are closed, with pass/fail fixtures for each new capability, real eslint
wired per-workspace and proven to fail CI on a planted violation (planted then
reverted within the branch), and `npm run audit` still green on the current repo
after any **true** positives the new checks surface are fixed in-scope.

## Constraints (inherited, non-negotiable)

- **v1 READ-ONLY.** No edits outside this repo.
- **ONE column.** Advance exactly one pipeline column; **no PRs** (conductor merges).
- **twf handoff** is the only handoff artifact.
- **Files touched:** `tools/audit/**` (linters + fixtures), per-workspace
  `eslint.config.js` + `package.json` `lint` scripts, `.gitignore` (item 0, if
  android needs adding), and any **trivial in-scope** true-positive fix the new
  checks surface. Anything non-trivial or out-of-scope → report on the card, do
  not fix.
- **No new dependencies** without escalation. eslint deps (`@eslint/js`,
  `typescript-eslint`) are already present at root (`configs/eslint.config.js`
  imports them); confirm they resolve before assuming a plain wire-up.
- **Remove the planted eslint violation before handoff.** The plant is a
  verification step, not a deliverable.

## Current-state ground truth (verified this session, HEAD a33dfe3)

- `npm run audit` → **all four linters green** right now.
- Audit architecture: `tools/audit/src/{cli,lib,no-duplication,no-literals,deps-declared,structure}.js`;
  shared helpers (`walkFiles`, `extractExportNames`, `listWorkspaces`, `stripComments`,
  `SKIP_DIRS`, `SOURCE_EXTS`) live in `lib.js`. `SKIP_DIRS` includes `test`, `tests`,
  `__tests__`, `fixtures` — so linters never descend into fixture trees or `test/` dirs,
  but **colocated `*.test.ts` files under `src/` ARE walked** (they are files, not dirs).
- `configs/eslint.config.js` exists (flat config, `js.configs.recommended` +
  `typescript-eslint`, ignores `dist/**`, `**/design/**`, `android/**`, `ios/**`).
  **Zero workspaces** define an `eslint.config.js` or a `lint` script (confirmed across
  all 9 workspaces). CI (`.github/workflows/ci.yml:53`) runs
  `npm run lint -w <ws> --if-present` → silent no-op everywhere today.
- `games/_template` and `games/marble_run` **both have `src/shell/`** on disk
  (`_template/src/shell/PlaceholderScreen.ts`, `marble_run/src/shell/App.ts`).
- `game.config.ts` exists at each game's top level and uses **copy keys**, not literals:
  `title: "game.title" satisfies CopyKey` — the sanctioned pattern (keys reference
  `design/copy.ts`).
- `packages/ui/package.json` devDeps `@fabrikav2/kernel` **and** it is imported by
  `packages/ui/src/{PauseOverlay,HomeMenu,ResultCard}.test.ts` via `@fabrikav2/kernel/flow`.
- `.gitignore:13` = `games/*/ios/`. **No `games/*/android/` rule exists.**
- Workspaces glob: `packages/*`, `games/*`, `tools/audit`, `tools/create-game`.

---

## Item 0 (do FIRST) — structure linter: allow generated native shells when gitignored

**Source:** conductor comment. Rule: a game's top-level `ios/` and `android/` are
LEGITIMATE **only when gitignored** (cap-generated, never committed; committed inputs
live in `native-resources/`). VIOLATION if tracked by git.

**Why now:** `marble_run` gained a real `ios/` shell (device install done). Local
`npm run audit` fails on it (the dir is on disk, not in `ALLOWED_DIRS`) while CI stays
green (untracked → not in the checkout). This is a local-vs-CI divergence that will
bite every dev who generates a native shell.

**Approach:**
- In `structure.js`, treat `ios/` and `android/` at a game's top level as **conditionally
  allowed**: allowed iff covered by `.gitignore`, violation iff git-tracked.
- Reuse the existing `workIsGitignored`-style deterministic `.gitignore` text check
  (see `structure.js` `workIsGitignored`) — but note the current `.work` check is a
  substring match. Native-shell coverage needs a rule matching `games/*/ios/` and
  `games/*/android/` (glob-ish); decide whether to (a) reuse the loose substring check
  or (b) tighten it. Simplicity-first: a substring check for `ios`/`android` in an
  active (non-`#`, non-`!`) gitignore line, mirroring `.work`, is consistent with the
  existing code.
- "Tracked by git" is the sharper signal than "gitignore mentions it." **Open decision
  (Q1):** does the linter shell out to `git ls-files games/<g>/ios` (accurate, needs git
  available in CI — it is), or infer tracked-ness purely from `.gitignore` (pure text,
  matches `workIsGitignored` precedent, but can't detect a force-added tracked file)?
  Recommendation: mirror the existing `.gitignore`-text precedent for consistency and
  zero new failure modes; the ban is "don't commit", and the gitignore rule is the
  committed statement of that policy. If the author wants true tracked-ness, `git ls-files`
  is the accurate check — pick one and document it in the linter header.
- **`.gitignore` gap to close:** add `games/*/android/` (only `games/*/ios/` exists
  today) so the android side of the rule has something to satisfy it. Trivial, in-scope.

**Fixtures (both ways):**
- `structure/pass/`: a game with a top-level `ios/` (and `android/`) + a fixture-local
  `.gitignore` covering them → **no violation**.
- `structure/fail/`: a game with a top-level `ios/` NOT covered by gitignore (or a
  tracked marker) → **violation** naming `native-resources/` as the home for committed
  inputs / "gitignore it" as the fix.
- Note: fixtures live under `tools/audit/test/fixtures/structure/` (a `SKIP_DIRS`-excluded
  subtree, so the real audit won't self-trip). Fixtures pass their own `.gitignore`/root
  to `lintStructure` — confirm the fixture harness can supply a fixture-local `.gitignore`
  (the current `workIsGitignored` reads `<root>/.gitignore`, so a fixture root with its
  own `.gitignore` works).

---

## Item 1 — no-duplication: add package↔package scan (finding 3)

**Today:** `lintNoDuplication` (`no-duplication.js:53-71`) only walks `games/*` and flags
a game DECLARING an export name a `packages/*` workspace already owns. Package-vs-package
and package-internal duplication is structurally invisible — which is exactly how the
`withTimeout`-×2 case (finding 2, `DeathAdCoordinator.ts:40` vs `with-timeout.ts:36`)
survived.

**Two distinct checks to add (the card names both):**
1. **Cross-package export collision:** a `packages/*` workspace declaring an EXPORT name
   that another `packages/*` workspace already exports. Re-export allowance stays: `export { x }
   from '@fabrikav2/other'` is re-use, not duplication (reuse `extractExportNames(text, {
   includeReExportsFromScope: false })`, already implemented in `lib.js`).
2. **Duplicate LOCAL function names across `packages/sdk`** (the `withTimeout` case). This is
   the harder one: `withTimeout` in `DeathAdCoordinator.ts` is a `const withTimeout = async …`
   **local**, not an export, so `extractExportNames` won't see it. Needs a **local-declaration
   scan** (`const/let/var/function NAME`) across sdk source, flagging a local name that
   collides with either (a) another local of the same name in a different file, or (b) a name
   already exported by the shared surface (`with-timeout.ts` exports `withTimeout`).

**Open decisions:**
- **Q2 (scope of the local-name check):** the card says "duplicate local function names across
  packages/sdk". Restrict to `packages/sdk` (matches the finding), or generalize to all
  `packages/*`? Recommendation: start scoped to what the finding proved (`packages/sdk`) to
  avoid a flood of false positives from common local names (`clamp`, `noop`, `id`) across
  unrelated packages. A repo-wide local-name scan is high-noise; keep it narrow + documented.
- **Q3 (false-positive risk):** common local helper names (`assert`, `clamp`, `noop`) will
  collide legitimately. Mitigation options: (a) only flag locals that collide with an
  **exported** shared name (the real footgun — someone will import the wrong one), (b) require
  the collision to cross files, (c) allowlist. Recommendation: (a) is the highest-signal,
  lowest-noise interpretation and directly catches the `withTimeout` case — a local shadowing
  a shared export. Treat pure local↔local collisions as a lower-priority secondary check or
  defer with a documented note.
- **Q4 (true positive to fix):** if the check is added and `DeathAdCoordinator.ts`'s local
  `withTimeout` still exists in this branch, the audit will newly fail. Per AC, fix trivial
  in-scope true positives. **But** `DeathAdCoordinator.ts` is in `packages/sdk/src/ads/` —
  editing sdk source is arguably out of the audit card's scope and touches divergent-contract
  behavior (finding 2 notes the local resolves-void, the shared rejects). **Recommendation:**
  if it surfaces, the rename (`withTimeout` → `raceOrIgnore`/`settleWithin`) is trivial and
  behavior-preserving, but it edits sdk — flag it explicitly in the handoff and decide with
  the conductor whether to fix here or report. Do NOT silently reconcile the divergent contract.

**Fixtures:**
- `no-duplication/pass/`: two packages, one re-exporting the other's symbol (`export { x }
  from '@fabrikav2/...'`) → no violation (re-export allowance holds).
- `no-duplication/fail/` (cross-package export): package B declares `export const foo` that
  package A already exports → violation.
- `no-duplication/fail/` (local dup): a package with a local `const withTimeout` while the
  shared surface exports `withTimeout` → violation.

---

## Item 2 — wire eslint for real + prove CI fails on a plant (finding 4)

**Today:** eslint base exists, zero consumers, CI lint is a no-op.

**Approach:**
- Per-workspace `eslint.config.js` re-exporting the base:
  `import base from "<rel>/configs/eslint.config.js"; export default [...base];`
  in every workspace (packages/*, games/*, tools/*). Relative depth differs
  (`packages/ui` → `../../configs/…`, `tools/audit` → `../../configs/…`, `games/marble_run`
  → `../../configs/…`); confirm each path.
- Add `"lint": "eslint ."` to each workspace `package.json` scripts. CI already calls
  `npm run lint -w <ws> --if-present` — once the script exists, it stops being a no-op.
- **Prove it fails:** plant a deliberate violation (e.g. an unused var / `no-unused-vars`)
  in one workspace, run the CI-equivalent command (`npm run lint -w <ws>` or `npm run lint`),
  observe non-zero exit, capture the output as evidence, then **revert the plant** before
  handoff. The AC requires "planted eslint violation demonstrably fails CI-equivalent command."
- **Open decision (Q5):** eslint over the whole repo may surface **pre-existing** violations
  in real source (unused vars, etc.) that make `npm run lint` red independent of the plant.
  The AC wants full gate green. If real violations surface: either fix trivial in-scope ones,
  or scope the initial eslint rule set conservatively (base config is `recommended` +
  `typescript-eslint recommended` — potentially noisy). **Recommendation:** run eslint across
  all workspaces early in `worked` to measure the true-positive surface BEFORE wiring scripts;
  if it is large, coordinate with conductor on whether to fix, relax rules, or narrow scope.
  Do not merge a red lint gate. This is the highest-uncertainty item — the plant is easy; a
  clean baseline across real source is the risk.

---

## Item 3 — no-literals: add game.config.ts to scope + document scanRoots (finding 9)

**Stale-premise correction:** the integration review worried "the scan targets
`games/*/src/shell/**` but that scan path may never match real game structure." **This is
now resolved** — `games/_template/src/shell/` and `games/marble_run/src/shell/` both exist.
The path is correct. Item 3's "fix or document the scanRoots path against the real template
layout" resolves to **document/confirm** (the `games/_template` card already landed with
`src/shell/`), not fix. Record this in the linter header so the next reader doesn't re-litigate.

**Real work — add `games/*/game.config.ts` to the scan:**
- User-facing string literals in config = violation; **copy keys** (dotted identifiers like
  `"game.title"` that reference `design/copy.ts`) are the sanctioned pattern and must NOT be
  flagged.
- **Detection nuance (Q6):** the current copy heuristic requires a DOM sink on the same line
  (`isDomSink`) + >2 words. `game.config.ts` has **no DOM sinks** — it is a declarative object.
  So the existing heuristic won't fire at all on config. A config-specific rule is needed:
  flag a string literal in `game.config.ts` that is **user-facing copy** (>2 words, or
  contains spaces / sentence-like) while **allowing copy keys** (identifier-shaped:
  `/^[a-z][\w]*(\.[\w]+)+$/`-style dotted keys, no spaces). The `satisfies CopyKey` typing
  already enforces keys at typecheck time, but the linter should catch a raw literal a game
  author pastes (`title: "Marble Madness"`). Recommendation: a small config-file branch in
  `no-literals.js` — for `game.config.ts`, treat any multi-word string literal not matching the
  copy-key shape as a `copy` violation; single-token dotted keys pass.
- **Q7:** should the scan cover only `game.config.ts` or all top-level game config? Card says
  `games/*/game.config.ts` specifically — keep it to that file (add to `scanRoots` as a file,
  not a dir walk; `scanRoots` currently returns dirs, so either push the config file path or
  special-case it).

**Fixtures:**
- `no-literals/pass/`: a `game.config.ts` using only copy keys (`title: "game.title"`) → no
  violation.
- `no-literals/fail/`: a `game.config.ts` with a raw user-facing literal (`title: "Marble
  Madness Deluxe"`) → `copy` violation.
- (Assign-then-sink var-taint case from finding 9 is explicitly OUT of scope — it's a
  documented known heuristic limit, not in this card's item list.)

---

## Item 4 — deps-declared: add unused-declared check (finding 10)

**Today:** `deps-declared` flags UNdeclared imports (phantom deps). The card adds the inverse:
a declared `@fabrikav2/*` dep with **zero imports** = warning.

**Stale-premise correction (important):** the card says "ui currently declares kernel unused."
That was true at review time. **Now** `packages/ui` imports `@fabrikav2/kernel/flow` in three
`*.test.ts` files under `src/`. So whether kernel is "unused" depends entirely on **whether the
unused-declared check counts test-file imports.**

**Open decisions:**
- **Q8 (do test imports count?):** `deps-declared`'s existing import scan uses `walkFiles` with
  `SOURCE_EXTS`, which **does** pick up colocated `*.test.ts` under `src/` (they are files, not
  in a `test/` dir). If the unused-declared check reuses that same walk, kernel counts as USED
  → no warning → the card's stated true positive **does not exist anymore**. If the check
  deliberately excludes `*.test.ts` (a dep only used in tests arguably belongs in devDeps, which
  it is — kernel IS a devDep here), then kernel is "unused by production code" → warning.
  **Recommendation:** a dep used only in tests, declared as a **devDep**, is correctly placed —
  do NOT warn on it. Reuse the existing import walk (counts test files); this makes ui/kernel a
  **false positive that the check correctly stays silent on**. Document this explicitly so the
  next reader understands why the card's named example does not fire. If the conductor wants
  prod-vs-test dep discipline, that is a larger, separate policy — out of scope here.
- **Q9 (warning vs error):** card says "warning". The current CLI treats any violation as a
  hard failure (`process.exit(1)`). A true warning (non-failing) needs a severity concept the
  CLI doesn't have. **Recommendation:** either (a) add a `severity: 'warn'` field that prints
  but doesn't set the failed flag, or (b) keep it a hard error (simpler, but then a legit
  unused-declared dep reddens the gate). Given the AC wants `npm run audit` green, and given
  ui/kernel (the only named case) resolves to no-warning per Q8, a hard-error implementation is
  viable IF the current repo has zero real unused-declared deps — **measure this in `worked`
  before choosing.** If any real unused-declared dep exists and can't be trivially dropped, a
  non-failing warning severity is required to keep the gate green.

**Fixtures:**
- `deps-declared/pass/`: a workspace declaring `@fabrikav2/x` and importing it → no warning.
  (Reuse/extend existing `deps-declared/pass` tree.)
- `deps-declared/fail-warn/`: a workspace declaring `@fabrikav2/x` with zero imports → warning.

---

## Acceptance criteria (from card) — how each is met

1. **New fixtures pass/fail as designed** — one pass + one fail fixture per new capability
   (items 0,1,3,4), asserted in the matching `*.test.ts` under `tools/audit/test/`.
2. **`npm run audit` green on current repo AFTER fixing true positives** — the new checks are
   re-grounded above so we distinguish real positives (must fix if trivial+in-scope, else report)
   from stale-premise false positives (ui/kernel, src/shell path). Known candidate true positive:
   sdk `withTimeout` local (Q4) — decide fix-vs-report with conductor since it edits sdk.
3. **Planted eslint violation demonstrably fails CI-equivalent command** — plant → run
   `npm run lint` → capture non-zero exit → revert plant before handoff.
4. **Full gate green** — `npm run test:unit --workspace=tools/audit && npm run audit &&
   npm run lint && npm run typecheck` all pass with plant removed.

**Verification command (from card):**
`npm run test:unit --workspace=tools/audit && npm run audit && npm run lint && npm run typecheck`

## Risk ledger (highest uncertainty first)

- **R1 — eslint baseline may be red on real source (item 2, Q5).** Wiring is easy; a clean
  `recommended` lint pass across all existing source is not guaranteed. Measure first; if noisy,
  escalate rule-scoping vs fix-all to conductor. This is the item most likely to overrun.
- **R2 — local-name duplication is high-noise (item 1, Q3).** Anchor to "local shadows a shared
  export" to keep signal high; a naive cross-file local-name scan will false-positive on common
  helper names.
- **R3 — warning severity (item 4, Q9).** The CLI has no non-failing severity today; adding one
  is small but is real surface. Only needed if a real unused-declared dep exists — measure.
- **R4 — sdk edit scope creep (item 1, Q4).** The `withTimeout` fix is trivial but lives in sdk,
  outside the audit card's natural blast radius. Report + decide, don't silently reconcile.

## Coordination notes

- **games/_template** already landed with `src/shell/` and `game.config.ts` copy-key convention
  — item 3's "coordinate via its README" is satisfied by the layout already on disk; no live
  coordination pending. Confirm against `games/_template/README.md` in `worked`.
- **marble_run** ios/ shell is the motivating case for item 0; `.gitignore:13` covers ios but
  not android — add `games/*/android/`.

## Out of scope (explicit)

- Reconciling finding 1 (owned-mirror `game_id` seam) or finding 5 (env resolver) — different
  cards.
- Var-taint / assign-then-sink upgrade to the no-literals copy heuristic (finding 9's second
  half) — documented known limit, not in this card's item list.
- Any sdk behavior change beyond a name-collision rename (item 1) — report, don't fix.

## Next stage (worked) entry criteria

`worked` inherits: the four per-item designs above, the four open-decision clusters (Q1–Q9)
to resolve with measurements from the real repo, the fixture matrix, and the eslint plant/revert
protocol. First action in `worked` should be **measurement**: run eslint across all workspaces
(R1) and dry-run the new duplication/unused-declared logic mentally against current source to
size the true-positive surface before writing linter code — this decides fix-vs-report and
severity for items 1, 2, 4.
