---
title: "HARNESS UPSTREAM: templatize driveTo + allstates tour + #__tourstate__ marker + device test scaffolding into games/_template"
date: 2026-07-07
trello: https://trello.com/c/vFSI5FwY
card: vFSI5FwY
stage: brainstormed
status: requirements-locked
---

# Templatize driveTo + insitu allstates tour + tourstate marker into games/_template — requirements

Grounded read of this worktree (`trello-vFSI5FwY-harness-upstream-templatize-driveto-alls`,
baseline `3f5ee1c`). Every file:line below was opened and verified against the
tree, not trusted from the card. This is a **templatize-and-scaffold** card: it
upstreams the marble_run device-verification surface (`driveTo` → the
`allstates` insitu tour → the `#__tourstate__` a11y marker → a `refs/manifest.yaml`)
into `games/_template` **game-agnostically**, so a fresh `create-game` output is
device-verifiable out of the box. It is verified **offline** by
`typecheck`/`test:unit`/`audit` and a `create-game` round-trip — never by device
runtime (device capture stays a downstream, human-gated lane; see §3).

Two premises in the card body are **stale** and are corrected in §0 so the plan
does not chase ghosts: the `.work/insitu-runner` drift is **already resolved**,
and the harness-linter **already passes** for the template today. The real gap is
narrower and sharper than the card title implies — see §0.4.

## 0. Where the ground truth is today (what already exists)

### 0.1 The marble_run reference surface (what we generalize FROM)

- **`games/marble_run/src/testing/driveTo.ts`** — a **pure, headless-testable**
  `driveTo(deps, state, opts)`. It types a `DriveState` union
  (`'menu'|'level'|'win'|'fail'|'settings'|'pause'`), normalizes to the menu, then
  drives to the target and **CONFIRMS arrival by polling `snapshot()`** before
  resolving (returns `false` on unknown state / unsolvable win-fail / timeout — an
  honest "did not reach"). Composes a small `DriveToDeps` interface
  (`gotoMenu`/`startLevel`/`openSettings`/`pause`/`autoWin`/`autoFail`/`snapshot`).
- **`games/marble_run/src/testing/insituTour.ts`** — `maybeRunInsituTour(app)`,
  gated on `VITE_INSITU_TOUR` (baked dev build) **or** `?insituTour=<script>` (web).
  The `'allstates'` script drives every canonical state via `h.driveTo(s)` and, per
  state, calls `mark(s)` which writes BOTH `<body data-tour-state>` AND the
  **off-screen `#__tourstate__` a11y element** with `aria-label="tourstate:<s>"`
  (`insituTour.ts:48-69`). Off-screen (`left:-9999px`), not opacity-faded, so it
  never contaminates a capture but stays in the a11y tree.
- **`games/marble_run/src/testing/autoPlay.ts`** — `driveAutoWin`/`driveAutoFail`,
  the solver-bound goal drivers `driveTo`'s `autoWin`/`autoFail` deps delegate to.
- **Wiring — `games/marble_run/src/main.ts:67-73`** (the pattern to mirror):
  ```ts
  if (isHarnessEnabled) {
    assignWindowBindings(window as unknown as Record<string, unknown>, {
      __MARBLE_RUN_HARNESS__: app.harness(),
      __MARBLE_RUN_GAME__: app,
    });
    void import('./testing/insituTour').then(({ maybeRunInsituTour }) => maybeRunInsituTour(app));
  }
  ```
  `isHarnessEnabled = TEST_HARNESS_ENABLED` (`App.ts:847`), defined in
  `core/Constants.ts:5` as `import.meta.env.MODE !== 'production' ||
  import.meta.env.VITE_ENABLE_TEST_HARNESS === 'true'`.
- **`games/marble_run/src/shell/App.ts`** — `harness()` exposes `driveTo` (705-710),
  delegating to a private `driveTo` (732-745) that wires App transitions to the
  pure `driveToState` deps; `snapshot()` (828-844) surfaces `scene`/`settingsOpen`/
  `status`/`inputReady` — the fields `driveTo` polls.
- **`games/marble_run/refs/manifest.yaml`** — hand-authored refcap manifest:
  `game`, a `reference` (Android/adb) lane, a `v2` lane (`driveTo` per state), and
  the six canonical states with `offline` PNGs + `gap:`/`manual:` annotations.

### 0.2 The single-source device runner (already unified — card item 4 is stale)

- **`tools/verify-device/`** is the single-source runner: a Node CLI
  (`cli.mjs` + `src/*.mjs`) that builds the harness bundle
  (`VITE_ENABLE_TEST_HARNESS=true VITE_INSITU_TOUR=allstates vite build`), installs
  on device, runs the XCUITest, diffs device captures vs `games/<g>/refs/` (same
  manifest `tools/refcap-compare` loads), scores with a vision panel, and emits a
  PASS/FAIL verdict. Gates gracefully (exit 0) with no device/key.
- **`tools/verify-device/runner/VerifyDeviceRunner/InsituTourTests.swift`** — the
  committed, **generic** XCUITest bundle (target bundle id injected via
  `TEST_RUNNER_TARGET_BUNDLE_ID`, never hardcoded). It is **element-gated**: it
  waits for the accessibility element labelled `tourstate:<state>` before each
  screenshot (54-69) and `XCTFail`s if a state never appears — the exact contract
  the `#__tourstate__` marker satisfies. Its header cites
  `games/marble_run/.work/insitu-runner` as the *origin it was generalized from*.
- **`games/marble_run/.work/` contains only `README.md`** — there is **no live
  `insitu-runner` there**. `.work/` is documented **gitignored scratch** ("only
  this README is committed … disposable by definition"). So the card's "remove the
  marble_run/.work/insitu-runner drift" is **already done**: the pattern was
  promoted into `tools/verify-device/runner/`, and no duplicate remains. This card
  need only **verify + document** that the runner is the single source (item 4
  collapses to a doc line in AGENT-HANDOFF, not a code removal).

### 0.3 The template's current test surface (what we generalize INTO)

- **`games/_template/src/shell/harness.ts`** — `createTemplateHarness()` implements
  the `@fabrikav2/testkit/harness` `GameHarness` contract with placeholder verbs:
  `snapshot`/`verbs`/`winLevel`/`failLevel`/`gotoState`/`startLevel`/cheats. It
  **derives states from config** via `seedStatesFromConfig(gameConfig)` (65) and
  uses the seeded kernel `mulberry32` rng (seeded-rand rule). **But it has NO
  `driveTo`** (the contract types it optional — `contract.ts:188`).
- **`games/_template/src/main.ts`** — `bootGame()` mounts a placeholder screen.
  It has **NO harness gate at all**: no `isHarnessEnabled`, no
  `assignWindowBindings`, no `maybeRunInsituTour`. **`createTemplateHarness` is
  never called** — it is an orphan stub compiled by typecheck but not mounted.
  ⇒ A fresh game inherits a harness *type-scaffold that is not actually exposed on
  `window` and cannot be driven*. THIS, not a missing `driveTo` line, is the core
  gap (see §0.4).
- **`games/_template/src/testing/`** does not exist (only `main.ts`, `shell/`).
- **`games/_template/refs/`** has only README stubs (`refs/{README,art,notes,video}`)
  — **no `manifest.yaml`**.
- **`games/_template/playwright.config.ts`** exists (extends `configs/playwright.base.ts`,
  port 5199) and **`tests/e2e/boot.spec.ts`** is a real boot smoke. There is **no**
  tour/allstates or collect-run e2e spec (marble_run has `collect-run.spec.ts`,
  `fidelity.spec.ts`, `play.spec.ts`, etc.).
- **`tools/create-game/src/create-game.mjs`** does a **recursive `cpSync` of the
  whole `_template` dir** (minus `node_modules`/`dist`/`coverage`). ⇒ Anything we
  add under `games/_template/` is inherited by every new game automatically; no
  create-game code change is needed for the files to propagate.

### 0.4 The audit harness-linter (already GREEN for the template)

- **`tools/audit/src/harness.js`** (Linter 6, WARN-first) scans a game's
  harness-bearing files (those importing `@fabrikav2/testkit/harness`) for four
  REQUIRED tokens: `snapshot`, `verbs`, `winLevel|autoWin`, `failLevel|autoFail`.
  The template's `harness.ts` already contains all four ⇒ **the template already
  passes the harness-linter today.** The AC clause "passes the audit
  harness-linter" is therefore **already satisfied**; the linter does **NOT** check
  for `driveTo`, the insitu tour, the `#__tourstate__` marker, or `refs/manifest.yaml`.
  ⇒ The linter gives us **no signal** that the new surfaces landed. The plan must
  decide (§4 Q4) whether to **extend the linter** to require `driveTo` + a marker +
  a manifest (so the AC's "exposes driveTo + tour + marker" is machine-enforced),
  or leave the linter as-is and rely on the create-game round-trip + a unit test.

## 1. Constraints (hard)

- **Game-agnostic, not a marble_run copy.** marble_run's `driveTo.ts` hardcodes a
  marble-specific `DriveState` union and a transition switch (`startLevel(1)` +
  `autoWin`/`autoFail`). The template version must be a **generalized scaffold**
  with `TODO(port)` seams — mirroring how `harness.ts` ships placeholder
  `winLevel`/`failLevel` that return `false` — never marble internals.
- **Additive + surgical.** Add files under `games/_template/`; wire the template
  `main.ts`/`harness.ts`. **Do not edit marble_run** (the harness-linter treats
  `autoWin`/`autoFail` as legacy aliases *because* marble_run must not be touched)
  and **do not edit `tools/verify-device/runner/`** (already the single source).
- **Offline / device-independent AC.** Everything must build and verify with no
  device: `typecheck && test:unit && audit`, plus a `create-game` round-trip. The
  on-device capture lane stays downstream and human-gated (§3).
- **Confirm-before-resolve is load-bearing.** The templatized `driveTo` must keep
  the "poll `snapshot()` to CONFIRM arrival, return `false` on timeout" contract —
  the whole point of `driveTo` (fidelity-diff ledger C5). A stub that returns bare
  `true` violates the harness thesis ("did I actually win?").
- **Marker contract is exact.** The `#__tourstate__` element must be off-screen
  (`left:-9999px`, not opacity), `role="text"`, with `aria-label="tourstate:<s>"`
  AND matching `textContent` — that byte-string is what `InsituTourTests.swift`
  waits on (54-69). Diverging breaks the device runner silently.
- **State-name source of truth.** Canonical device states are `menu`/`level`/
  `settings`/`pause`/`win`/`fail` (`CANONICAL_STATES` in
  `tools/refcap-compare/src/manifest.mjs`; marble_run `DriveState`). But
  `seedStatesFromConfig` derives from `gameConfig.screens` (template =
  `["HomeMenu"]`). These two vocabularies **differ**; the plan must reconcile them
  (§4 Q1) rather than silently pick one.
- ONE Trello column of work per stage; `twf` handoff between stages. **No PRs.**

## 2. What this card ships (scope, in card order)

### 2.1 `games/_template/src/testing/driveTo.ts` + wire into the harness

- A **generalized, game-agnostic** `driveTo(deps, state, opts)` scaffold: keep
  marble_run's pure structure (normalize→drive→confirm-via-`snapshot()` poll, honest
  `false`), keep the canonical `DriveState` set, but replace the marble-specific
  transition bodies with `TODO(port)` seams over the same `DriveToDeps` interface.
- Expose `driveTo` on `TemplateHarness` (add to `createTemplateHarness`'s return,
  wiring the deps to the template's placeholder transitions — the mirror of
  `App.ts:732-745`). The contract already types it optional (`contract.ts:188`).
- **Unit test** (`tests/unit/`) driving the pure `driveTo` against a fake deps
  object with an injected `sleep` no-op (marble_run's `drive-to.test.ts` pattern),
  asserting confirm-on-timeout returns `false`.

### 2.2 `games/_template/src/testing/insituTour.ts` — allstates tour + marker

- Port `maybeRunInsituTour(app)` game-agnostically: same env/URL gate
  (`VITE_INSITU_TOUR` | `?insituTour=`), same `'allstates'` loop over the canonical
  states via `h.driveTo(s)`, same `mark(s)` writing `<body data-tour-state>` + the
  off-screen `#__tourstate__` a11y element (§1 exact contract), same
  element-gate-friendly dwell. Generalize the `App` type to the harness contract so
  it is not marble-bound.
- **Wire into `games/_template/src/main.ts`**: add the `isHarnessEnabled` gate
  (a template `TEST_HARNESS_ENABLED` mirroring marble_run's Constants), call
  `createTemplateHarness(...)`, `assignWindowBindings(window, { __<GAME>_HARNESS__:
  harness })`, and `void import('./testing/insituTour').then(m => m.maybeRunInsituTour(...))`.
  **This closes the orphan-stub gap (§0.3): today the template harness is never
  mounted.** The window-binding key must be templatized (create-game already
  substitutes `id`/title — decide the key convention, §4 Q3).

### 2.3 `games/_template/refs/manifest.yaml` stub + inherited playwright/e2e setup

- Add a `refs/manifest.yaml` **stub** valid against
  `tools/refcap-compare/src/manifest.mjs` `loadManifest`: top-level `game`,
  `reference.package`, and the canonical `states` each with a `driveTo:` target and
  an explicit `gap:` (no captures exist for a fresh game — "absence documented, not
  silent"). Decide hand-authored stub vs generated-from-`seedStatesFromConfig`
  (§4 Q1).
- Confirm the template's existing `playwright.config.ts` + `tests/e2e/` is the
  "full test setup" a game inherits; if a tour/collect-run e2e is in scope, add a
  minimal skeleton spec (keep it a *real* boot-level check, not a stub — matching
  `boot.spec.ts`'s "real, not a stub" note). **Scope guard:** do not port
  marble_run's full e2e suite; only what a fresh game needs to *inherit the shape*.

### 2.4 Unify/verify the device runner (largely documentation — see §0.2)

- **No code removal needed**: `tools/verify-device/runner/` is already the single
  source and `.work/insitu-runner` no longer exists. Verify this holds, and
  **document in `docs/AGENT-HANDOFF.md`** that (a) `tools/verify-device` is the
  single device-runner source, (b) `.work/` is disposable scratch, and (c) a
  fresh game now inherits `driveTo` + tour + marker + manifest.
- If §4 Q4 chooses to enforce the new surface, extend `tools/audit/src/harness.js`
  (+ `tools/audit/test/fixtures/harness/{pass,fail}/`) to require `driveTo` + the
  marker + a `refs/manifest.yaml`, WARN-first.

## 3. Out of scope

- Any edit to `games/marble_run/**` or `tools/verify-device/runner/**`.
- Real on-device capture / a green device verdict (the device lane stays
  downstream + human-gated; ledger device gap stays open — ship the offline
  scaffold + honest doc, never a claimed device pass).
- Real gameplay logic in the template `driveTo`/`winLevel`/`failLevel` (they stay
  `TODO(port)` scaffolds, like the existing placeholder verbs).
- A `refs/manifest.yaml` **generator** tool (does not exist today; marble_run's is
  hand-authored). If a generator is wanted it is a separate card.
- Retrofitting marble_run onto any renamed surface.

## 4. Open questions for the plan stage

1. **State-vocabulary reconciliation.** Canonical device states
   (`menu/level/settings/pause/win/fail`, `refcap-compare` `CANONICAL_STATES`) vs
   `gameConfig.screens` (template `["HomeMenu"]`) vs `driveTo`'s `DriveState` union.
   Does the template `driveTo` keep the fixed canonical set (device-capture
   vocabulary) while `gotoState` stays config-driven, and the manifest map
   `canonical-state → gotoState-target`? Name the mapping so a port isn't guessing.
2. **Generalizing `driveTo`'s transition switch.** marble_run's switch encodes
   game rules (`startLevel(1)`, win→`autoWin`+confirm `complete`). What does the
   *template* scaffold return for each state — placeholder `false` with `TODO(port)`
   (mirrors `winLevel`), or a minimal real drive to the placeholder screen for
   `menu`? Decide how much is demonstrable vs stubbed.
3. **Window-binding key convention.** marble_run uses `__MARBLE_RUN_HARNESS__`.
   The template needs a key create-game can substitute (it already substitutes
   `id`/title). Fixed `__GAME_HARNESS__`, or derived from `gameConfig.id`? The
   testkit playwright bridge (`waitForHarness`) reads `window[key]` — pick a key it
   can find generically.
4. **Enforce the new surface in the linter (or not).** The harness-linter already
   passes without `driveTo`/tour/marker/manifest (§0.4). Extend it to require them
   (machine-enforces the AC's "exposes driveTo + tour + marker") — accepting a
   WARN-first rollout and new fixtures — or rely on a unit test + create-game
   round-trip? This decides whether the AC is gate-verified or test-verified.
5. **Manifest stub: authored vs generated.** Hand-author `refs/manifest.yaml` (like
   marble_run) with `gap:` everywhere, or derive states from
   `seedStatesFromConfig(gameConfig)` inline? Generated keeps one source of truth
   but needs the state-vocabulary mapping (Q1) resolved first.
6. **e2e scope.** Is an inherited tour/collect-run e2e spec in scope for "full test
   setup", or is the existing `boot.spec.ts` + `playwright.config.ts` sufficient?
   Bound this so §2.3 doesn't balloon into porting marble_run's whole e2e suite.

## 5. Verification (offline; commands confirmed present at repo root)

```bash
npm run typecheck        # template driveTo + insituTour + harness wiring typechecks
npm run test:unit        # template drive-to unit test (+ existing smoke) pass
npm run audit            # harness (+ any extended) linter GREEN for _template
npm run create-game -- probe_game   # fresh scaffold inherits testing/ + refs/manifest.yaml
#   then: grep driveTo + '#__tourstate__' + refs/manifest.yaml in games/probe_game,
#   npm run typecheck -w @fabrikav2/probe_game, npm run audit, then delete probe_game
```

The device lane (`npm run verify-device -- --game <g>`) is **NOT** part of this
card's AC — it is exercised downstream on real hardware and reported as an
explicit **unverified-on-device** gap in the handoff.
