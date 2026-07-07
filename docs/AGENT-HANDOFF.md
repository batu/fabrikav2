# AGENT-HANDOFF — claim-gated verify enforcement layer

This document describes the **structural** verification enforcement added by card
`elkcIthD`. The point: AGENTS.md #7/#8 and the `verify-device` tool both route
through the agent's *judgment*, so verification stays skippable — and it was
skipped repeatedly (proxy substitution) and rubber-stamped. This layer moves
enforcement **from judgment to structure**. Everything here is DETERMINISTIC (no
LLM) and SELF-DISABLING (a no-op for non-game projects).

## The five pieces

All logic lives in `tools/verify-gate/` (a unit-tested Node workspace). The shell
hook is a thin shim that self-disables and delegates.

### 1. Claim-gated Stop hook
- **Shim:** `agents/hooks/verify-visual-claim.sh` (mirrored to `.claude/hooks/`
  by the standard sync — see "Activation" below).
- **Wired in:** `agents/settings.json` under a `Stop` hook.
- **Core:** `tools/verify-gate/cli.mjs` → `src/classify.mjs`.
- On turn end it reads the **last assistant message** from the transcript and
  **BLOCKS** (Claude Code Stop-hook `{"decision":"block"}`) **iff ALL** of:
  1. the message makes a **done-claim** (regex, case-insensitive:
     `done|verified|works|renders? correctly|looks right|matches the reference|pixel|fidelity|shipped|complete on device`,
     anchored to word boundaries so `abandoned`/`frameworks` don't false-fire);
  2. `git diff` vs the merge-base with `origin/main` (plus untracked files)
     touches a **visual glob**: `games/*/src/**`, `games/*/design/**`,
     `packages/ui/**`;
  3. there is **no fresh** verify-device evidence — no
     `docs/evidence/*device-verify*/panel.json` (or `games/*/evidence/**/panel.json`)
     with an mtime **newer** than the newest changed visual file;
  4. the message has **no `UNVERIFIED:` marker**.
- The block message names the changed visual files, the exact command
  `npm run verify-device -- --game <g>`, and cites AGENTS.md #8.
- **Gate on the CLAIM, not the file:** a refactor that touches a visual file but
  makes no done-claim does **not** block. This precision is the whole point and
  is unit-tested (`test/decide.test.mjs`, `test/classify.test.mjs`).

### 2. UNVERIFIED ledger (self-disabling escape hatch)
- When the last message contains `UNVERIFIED: <reason>`, the hook appends
  `{ts, changed_files, reason}` to `.work/verify-ledger.jsonl` and **does not
  block**. Skipping stays possible — but is **recorded, never silent**.
- Core: `src/ledger.mjs`.

### 3. Merge gate (ship-time backstop)
- `tools/verify-gate/merge-gate.mjs` (root script:
  `npm run verify-merge-gate`). For a diff that touches visual globs it
  **HARD-FAILS** (exit 1) when there is no fresh structured `panel.json`
  covering the affected game: `game` must match, `lane` must be `device`,
  `generatedAt` must be newer than the visual change, and `verdict.pass` must be
  `true`. Cross-game panels, browser-lane panels, failing verdicts, corrupt
  panels, stale panels, git-diff errors, and deleted visual files without fresh
  evidence all fail closed. This is the ship-time backstop for the escape hatch.
  Fail-**closed** (an unexpected error is a hard fail), unlike the Stop hook
  which fails **open**.
- Conductors run it through the hard landing gate below, not as an adjacent
  best-effort command.

### 4. Landing gate (no pipe masks)
- `tools/verify-gate/land-gate.mjs` (root script: `npm run land-gate`) composes
  `project-gate` + `verify-merge-gate` as direct child processes and preserves
  each child exit code. Do **not** pipe it through `tail`, `tee`, `grep`, or any
  other command before testing `$?`; the incident class was a red gate masked by
  a pipeline.
- `agents/config.json` sets `twf_gate.cmds` to `npm run land-gate`, so
  `twf merge-card` reaches cleanup only after the hard landing gate returns 0.
- When a conductor is manually deciding whether it is safe to delete a card
  branch/worktree, run `npm run land-gate -- --branch trello-<shortid>-<slug>`
  or `npm run land-gate -- --shortid <shortid>`; that adds
  `verify-landed-gate` and proves the branch tip is on the integration ref
  before cleanup.

### 5. Live activation mirror check
- `tools/verify-gate/check-claude-mirror.mjs` (root script:
  `npm run check-claude-mirror`) fails when `agents/settings.json` or
  `agents/hooks/*` drift from their live `.claude/` mirrors. It is included in
  `project_gate.cmds`, so a checkout cannot claim Stop-hook activation while the
  live Claude files are inert or stale.

## Self-disable (catalog-safe)
Both the shell shim and the Node cores exit as a no-op when
`tools/verify-device/cli.mjs` is absent **or** there is no `games/` dir. Safe to
promote catalog-wide to non-game projects — it simply does nothing there.

## Activation / sync
The card's footprint is `agents/**` (the source of truth). Claude Code loads the
**live** copies under `.claude/` (`.claude/settings.json`, `.claude/hooks/`),
which are byte-identical mirrors maintained by the `agents/ → .claude/` sync
(same as `block-destructive-git.sh`). This worker committed only the `agents/`
source; **the conductor's sync step must mirror `agents/hooks/verify-visual-claim.sh`
and the `Stop` hook in `agents/settings.json` into `.claude/`** to make the hook
live. Catalog promotion is a separate conductor step (do not touch the agency
repo).

## Tests
`npm run test:unit -w @fabrikav2/verify-gate` covers done-language detection
(positive + negative including refactor-no-claim, `tested on device`, unresolved
pixel prose, and `Pixel 8`), visual-glob matching, structured panel evidence
(stale, fresh, cross-game, browser lane, failing verdict, corrupt panel),
UNVERIFIED ledger append, self-disable when tool/games are absent, transcript
parsing, fail-closed git diff plumbing, merge-gate CLI failures, land-gate
ordering, `.claude` mirror drift, and both `decideStop`/`decideMerge` gates. The
shell hook delegates to this tested Node core — logic is unit-tested, not just
bash.

---

# AGENT-HANDOFF — templatize driveTo + insitu allstates tour + tourstate marker (card vFSI5FwY)

Upstreams marble_run's device-verification surface into `games/_template` so a
fresh `create-game` output is device-verifiable out of the box (previously the
review finding was: no `driveTo`, no `insituTour`, no `#__tourstate__` marker,
and the template's `createTemplateHarness` was compiled but never mounted).
See the requirements brainstorm for the full grounded read:
`docs/brainstorms/2026-07-07-harness-upstream-template-driveto-tour-marker-requirements.md`.

## What landed

- **`games/_template/src/testing/driveTo.ts`** — the pure, game-agnostic
  `driveTo(deps, state, opts)` ported from marble_run verbatim (it was already
  deps-based, not marble-specific): normalises to menu, drives to the target,
  CONFIRMS arrival by polling `snapshot()`, and returns an honest `false` on an
  unknown state / unreached terminal / confirmation timeout. The `sceneIs`/
  `playingReady` confirm predicates assume the shared `@fabrikav2/kernel`
  `FlowStates` names (`menu`/`playing`/`complete`/`failed`/`paused`) — a port
  whose `snapshot().scene` uses those names gets working confirms for free.
- **`games/_template/src/testing/insituTour.ts`** — `maybeRunInsituTour(harness)`,
  generalized to take a `GameHarness` directly (no `App` wrapper class exists in
  the template). Same env/URL gate (`VITE_INSITU_TOUR` | `?insituTour=`), same
  `'allstates'` loop over the six canonical states via `harness.driveTo(s)`,
  same `mark(s)` writing `<body data-tour-state>` + the off-screen
  `#__tourstate__` a11y element with `aria-label`/`textContent` both set to
  `tourstate:<s>` — byte-exact with the element-gate contract
  `tools/verify-device/runner/VerifyDeviceRunner/InsituTourTests.swift` waits
  on. Dropped marble_run's non-`allstates` scripted win/fail dwell path — out of
  scope; a fresh template has no solver-bound win/fail to demo yet.
- **`games/_template/src/shell/harness.ts`** — added `driveTo(state)`, wiring
  `../testing/driveTo.ts`'s deps to the template's placeholder transitions
  (`gotoMenu`/`openSettings`/`pause` are `TODO(port)` no-ops; `startLevel`
  delegates to the existing placeholder; `autoWin`/`autoFail` delegate to
  `winLevel`/`failLevel`, which already return `false`). Exposed on the
  returned `TemplateHarness` (the contract already typed `driveTo` optional).
- **`games/_template/src/main.ts`** — closed the orphan-stub gap: added a
  `TEST_HARNESS_ENABLED` gate (mirrors marble_run's `core/Constants.ts`),
  calls `createTemplateHarness(...)` (previously never invoked anywhere),
  `assignWindowBindings(window, { __GAME_HARNESS__: harness })`, and lazily
  imports + runs `maybeRunInsituTour(harness)`. A fresh game's harness is now
  actually mounted and drivable, not just compiled.
- **`games/_template/refs/manifest.yaml`** — a refcap-compare manifest stub
  (valid against `tools/refcap-compare/src/manifest.mjs` `loadManifest`): all
  six canonical states, each lane (`reference`/`v2`) declaring an explicit
  `gap:` (a fresh game has zero captures) plus a `driveTo:` target for the v2
  lane. `reference.package`/`v2.package`/the top-level `game:` field are
  placeholders a port edits by hand (same posture as `game.config.ts`'s
  per-game fields — `create-game` does not substitute them).
- **`games/_template/tests/unit/drive-to.test.ts`** — headless unit test for
  the pure `driveTo`, against a fake deps object (not a real FlowMachine, since
  the template's own harness deps are still `TODO(port)` no-ops): all six
  states reach + confirm against the fake, unknown state honestly returns
  `false`, and a terminal driver that never transitions honestly times out to
  `false` (the confirm-before-resolve contract).

## Decisions on the brainstorm's open questions

- **State vocabulary (Q1):** kept `driveTo`'s canonical
  `menu/level/win/fail/settings/pause` set (the device-capture vocabulary) as
  the fixed `DriveState` union; `gotoState` stays `gameConfig.screens`-driven,
  unchanged. No mapping table was needed — `driveTo`'s deps interface never
  references `gameConfig.screens` at all, so the two vocabularies coexist
  without merging.
- **Transition bodies (Q2):** template `driveTo` deps are `TODO(port)`
  placeholders (mirrors `winLevel`/`failLevel`'s existing `return false`) —
  confirm-before-resolve stays load-bearing, so an un-ported template's
  `driveTo` honestly returns `false` for every state rather than faking a pass.
- **Window-binding key (Q3):** fixed `__GAME_HARNESS__`, not derived from
  `gameConfig.id`. `@fabrikav2/testkit/playwright`'s `waitForHarness` takes the
  window key as a caller argument, not a hardcoded name, so no `create-game`
  substitution step is needed — simpler than templating the key.
- **Linter enforcement (Q4):** did **not** extend `tools/audit/src/harness.js`.
  It already passes for the template (`snapshot`/`verbs`/`winLevel`/`failLevel`
  tokens were already present) and adding `driveTo`/marker/manifest checks
  would be new WARN-first scope beyond this card's ask; the unit test +
  `create-game` round-trip below are the enforcement for now. Revisit as a
  follow-up if a future card wants the AC machine-gated.
- **Manifest (Q5):** hand-authored stub (marble_run's own manifest is also
  hand-authored; no generator exists).
- **e2e scope (Q6):** did not add a tour/collect-run e2e spec — the existing
  `playwright.config.ts` + `tests/e2e/boot.spec.ts` already covers "inherit the
  full test setup" per the AC; porting marble_run's e2e suite was explicitly
  out of scope (§3 of the brainstorm).

## Device runner — already unified (no code change)

Confirmed `tools/verify-device/` is the single-source device runner and
`games/marble_run/.work/` is disposable gitignored scratch (README only, no
live `insitu-runner`) — the card's "remove drift" premise was already stale
(see the brainstorm §0.2). Nothing to remove; noting it here satisfies the
card's documentation ask.

## Verified-how

- `node tools/audit/src/cli.js` (pure Node, no `node_modules` dependency) —
  PASS, `harness: ok` for `_template` (unaffected; the linter doesn't check the
  new surface — see Q4 above).
- `node tools/create-game/src/create-game.mjs probe_game` (pure Node) then
  `node -e "loadManifest('games/probe_game')"` — the new
  `src/testing/{driveTo,insituTour}.ts`, `tests/unit/drive-to.test.ts`, and
  `refs/manifest.yaml` all copied into the scaffold and the manifest validated;
  `node tools/audit/src/cli.js` still passed with `probe_game` present.
  `probe_game` was deleted after the check (nothing committed).
- `npx tsc --noEmit` inside `games/_template` — clean, **before** a shared
  `node_modules` symlink in the main checkout became circular/self-referential
  mid-session (external, concurrent-process breakage, unrelated to this diff —
  see the handoff's Surprises). Re-run once the shared install is repaired.

## NOT verified (env-blocked, flag before trusting)

- `npm run test:unit` for `games/_template` (the new `drive-to.test.ts`) and
  `npm run typecheck`/`npm run lint` via the root npm scripts could **not** be
  re-run after `/Users/base/dev/appletolye/fabrikav2/node_modules` became a
  circular self-symlink partway through this session (`readlink node_modules`
  → itself) — every worktree on this machine shares that directory via a
  symlink, so this blocks all `npm`/`npx` invocations repo-wide, not just this
  card's files. Re-run `npm run test:unit -w @fabrikav2/game-template` and
  `npm run typecheck -w @fabrikav2/game-template` once `node_modules` is
  reinstalled clean.
- On-device capture (XCUITest driving the new template harness) — explicitly
  out of scope for this card (§3 of the brainstorm); stays a downstream,
  human-gated lane.
