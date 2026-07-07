---
title: "FIX(F3): _template truly device-verifiable"
date: 2026-07-07
trello: https://trello.com/c/Hi6nHsXv
card: Hi6nHsXv
origin_findings: https://trello.com/c/lKnRrcty
stage: brainstormed
status: requirements-locked
---

# _template truly device-verifiable - requirements

This is the fix follow-up to review card `lKnRrcty`. The reviewed upstream card
added the first-pass template harness, `driveTo`, `insituTour`, and manifest
stub, but the review found that a fresh scaffold still cannot pass the
device-verification contract honestly. This card is a narrow hardening pass:
make the template harness state real enough to verify, align harness identity
with `tools/verify-device`'s existing convention, add tests that catch
false-success paths, and document the autonomy ruling.

## Ground Truth From The Review

Findings that this card must resolve:

1. Blocker: `games/_template/src/shell/harness.ts` exposes a mounted harness, but
   `snapshot()` always reports the first configured screen (`HomeMenu`) and the
   transition deps are no-ops. `driveTo` confirms kernel flow scene names
   (`menu`, `playing`, `complete`, `failed`, `paused`), so the allstates tour
   currently publishes `tourstate:<state>-FAILED` for states it cannot actually
   reach. `InsituTourTests.swift` waits for exact `tourstate:<state>`, so this
   is not device-verifiable out of the box.
2. Major: template harness identity drifts from `verify-device`. The template
   exposes `window.__GAME_HARNESS__`, while `tools/verify-device/src/browserLane.mjs`
   derives `__${manifest.game.toUpperCase()}_HARNESS__`. The fix must align the
   template and `create-game` to that existing verify-device convention. Do not
   edit `tools/verify-device`.
3. Major: `driveTo` tests do not catch a terminal action that returns `true`
   while the state remains `playing`. Both `_template` and `marble_run` need
   win/fail negative cases for this "lying success" path.
4. Major: template tests exercise only pure fake deps, not
   `createTemplateHarness()` or the real `maybeRunInsituTour()` flow.
5. Minor: `games/_template/tests/README.md` describes Playwright without a
   device-first caveat.
6. Documentation: the conductor ruled that the in-app allstates tour is allowed
   only as a deterministic scripted fixture because XCUITest cannot reach JS
   inside WKWebView. Any branching or judgment added to that tour violates the
   autonomy contract.

## State Model Requirement

Use a tiny deterministic placeholder state object in
`games/_template/src/shell/harness.ts`. Do not add an engine, renderer, solver,
or speculative framework.

The model needs to satisfy both vocabularies:

- Public tour / refcap targets stay the existing six canonical capture states:
  `menu`, `level`, `settings`, `pause`, `win`, `fail`.
- `snapshot().scene` uses the canonical `@fabrikav2/kernel` flow names already
  assumed by `driveTo.ts`: `menu`, `playing`, `complete`, `failed`, `paused`.
- `settings` is represented as `scene: "menu"` plus `settingsOpen: true`, as in
  the existing driveTo predicate.

Minimum transitions:

- Initial state: `scene: "menu"`, `settingsOpen: false`, `status: "idle"`,
  `inputReady: true`.
- `gotoMenu()` mutates the placeholder state back to menu and closes settings.
- `startLevel()` mutates to `scene: "playing"`, closes settings, and makes input
  ready.
- `openSettings()` mutates `settingsOpen: true` without inventing a separate
  flow scene.
- `pause()` mutates `playing -> paused`.
- `winLevel()` and `failLevel()` deterministically flip only
  `playing -> complete` / `playing -> failed` and return `true` iff the
  corresponding scene is confirmed after mutation.
- `snapshot()` reads this state object and must never synthesize stale
  `HomeMenu` names.

Acceptance signal: `createTemplateHarness(...).driveTo()` returns `true` for
all six public capture states on a fresh template harness, and
`maybeRunInsituTour()` publishes true markers for all six plus `done`:
`tourstate:menu`, `tourstate:level`, `tourstate:settings`,
`tourstate:pause`, `tourstate:win`, `tourstate:fail`, `tourstate:done`.
No `-FAILED` marker should appear in the fresh-template happy path.

## Harness Identity Requirement

Do not touch `tools/verify-device`. Align to it.

Current verify-device convention:

- `tools/verify-device/src/browserLane.mjs` derives the browser harness key as
  `__${game.toUpperCase()}_HARNESS__`.
- `tools/verify-device/cli.mjs` loads `manifest.game` from
  `games/<game>/refs/manifest.yaml` and passes that through the browser lane.

Implementation requirements:

- In `games/_template/src/main.ts`, derive the window key from
  `gameConfig.id.toUpperCase()`, so the template exposes
  `__TEMPLATE_HARNESS__` and a scaffolded `my_game` exposes
  `__MY_GAME_HARNESS__`.
- In `tools/create-game/src/create-game.mjs`, substitute
  `games/<new>/refs/manifest.yaml` so top-level `game: template` becomes
  `game: <name>` and `v2.package: com.fabrikav2.template` becomes
  `v2.package: com.fabrikav2.<name>` unless the implementation deliberately
  matches the Capacitor app id convention. If choosing the latter, document the
  reason in the plan and update tests accordingly.
- Add or extend a `tools/create-game` unit test that proves scaffolded
  `manifest.yaml`, `game.config.ts`, and the derived harness key all agree.

## Test Requirements

Template tests:

- Keep the pure `driveTo` tests, but add negative cases where `autoWin()` and
  `autoFail()` return `true` while `snapshot().scene` remains `playing`; assert
  `driveTo()` returns `false`.
- Port the marble_run `inputReady` never-ready negative to `_template`: if
  `inputReady` never becomes `true`, terminal `autoWin`/`autoFail` must not be
  trusted and `driveTo()` must return `false`.
- Add tests that instantiate `createTemplateHarness()` and call its exported
  `driveTo()` for all six public capture states. These tests must fail against
  the current stale placeholder and pass with the deterministic state object.
- Add `_template` tests for `maybeRunInsituTour()` using a fake `GameHarness`
  or the real template harness where practical. Cover:
  - allstates drive order,
  - true markers for the happy path,
  - `-FAILED` marker when one `driveTo` returns `false`,
  - off-screen `#__tourstate__` marker with exact `aria-label` and
    `textContent`,
  - `done` sentinel,
  - no-script no-op.

Marble_run tests:

- In `games/marble_run/tests/unit/drive-to.test.ts`, add the same
  lying-success win and fail negatives: terminal driver returns `true`, scene
  remains `playing`, expected result is `false`.
- Keep the existing input-ready positive coverage.

Create-game tests:

- Extend the hermetic fixture in `tools/create-game/test/create-game.test.js` to
  include `refs/manifest.yaml` and a main/harness-key-bearing file if needed.
- Assert the scaffolded output rewrites:
  - `game.config.ts` id,
  - manifest `game`,
  - manifest `v2.package`,
  - the key convention implied by `gameConfig.id` and manifest game.

Tour tests:

- Unit-level headless tour verification is acceptable for this card's AC:
  it proves the allstates fixture publishes the exact labels the device runner
  waits on. Do not claim real mobile verification until `verify-device` captures
  a plugged-in device in a later stage.

## Documentation Requirements

Update the header comment in `games/_template/src/testing/insituTour.ts` and
the `_template` section of `docs/AGENT-HANDOFF.md`:

- The allstates tour is a deterministic scripted fixture.
- It has a fixed state list and no judgment.
- It is permitted under the autonomy law only because XCUITest cannot directly
  call JS inside WKWebView.
- Any future branching, heuristic selection, visual judgment, retry policy, or
  convergence loop inside the game bundle violates the project rule. Such logic
  belongs in the agent or an external one-shot tool that returns.

Also update `games/_template/tests/README.md`:

- Label Playwright as browser smoke only.
- State that mobile-game close-out requires `verify-device` on-device capture
  and device evidence, not browser or simulator proof.

## Scope Boundaries

Allowed footprint:

- `games/_template/**`
- `games/marble_run/tests/unit/drive-to.test.ts`
- `tools/create-game/**`
- `docs/**`

Explicitly do not edit:

- `tools/verify-device/**` - another worker owns it; this card aligns to its
  current convention.
- Unrelated marble_run source or visual/gameplay files.
- Shared package APIs unless a local type import already supports the change.

## Verification Plan

The implementation worker should run the narrowest checks that observe the new
behavior, then the landing gate:

1. `npm run test:unit -w @fabrikav2/game-template`
2. `npm run test:unit -w @fabrikav2/marble_run -- tests/unit/drive-to.test.ts`
3. `npm run test:unit -w @fabrikav2/create-game`
4. `npm run typecheck -w @fabrikav2/game-template`
5. `npm run audit`
6. `npm run land-gate`

If any command is blocked by missing local dependencies, say so explicitly in
the handoff and name the unverified behavior. Passing browser/unit tests is not
real device verification; it only satisfies this card's unit-level AC for the
fresh-scaffold allstates marker contract.

## Acceptance Criteria

- Fresh `_template` harness has a deterministic placeholder state model.
- `createTemplateHarness().driveTo()` returns `true` for all six public capture
  states and mutates/query-confirms via `snapshot()`.
- Headless allstates tour emits six true `tourstate:<state>` markers plus
  `tourstate:done`, with no `-FAILED` on the fresh-template happy path.
- Template and create-game expose/emit the verify-device-derived harness key
  convention.
- Create-game substitution for manifest game and `v2.package` is unit-tested.
- Lying-success terminal driver cases fail honestly in both `_template` and
  `marble_run` tests.
- Template tests cover real `createTemplateHarness()` and `maybeRunInsituTour()`.
- `games/_template/tests/README.md`, `insituTour.ts`, and `docs/AGENT-HANDOFF.md`
  document the device-first and deterministic-fixture rulings.
- No edits under `tools/verify-device/**`.
