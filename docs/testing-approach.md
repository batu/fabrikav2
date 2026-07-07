# Testing approach: the four layers

This is the reference doc for how a fabrikav2 game gets tested, tying together
work that so far has lived split across `docs/architecture/reference-fidelity-harness.md`,
`docs/plans/2026-07-06-001-tooling-verify-device-plan.md`, `tools/verify-device/README.md`,
and the capability ledger (`docs/retros/insitu-testing-capability-notes.md`).
None of those documents state the four-layer shape end to end, or name the one
gap that survives all four layers today. This doc does both, and proposes the
minimal fix for the gap (proposal only — not implemented by this card).

## The four layers

### 1. Unit tests (vitest, per workspace)

Every package and game workspace runs `npm run test:unit` (vitest). Example:
`games/_template/tests/unit/smoke.test.ts` boots the kernel flow machine
directly (no browser, no DOM beyond jsdom) and asserts the mounted screen and
config. `packages/testkit`'s own logic (harness contract helpers, capture,
perf, envelope wrapping) is unit-tested the same way
(`packages/testkit/src/harness/*.test.ts`).

Covers: pure logic, state machines, data transforms, kernel/sdk/testkit
internals. Does **not** touch a real DOM event, a real screen, or a real
device.

### 2. Playwright e2e (browser)

`games/<g>/tests/e2e/*.spec.ts`, run against a vite dev server
(`games/_template/tests/e2e/boot.spec.ts` is the skeleton: boot the page,
assert the placeholder screen renders). This is real-browser but
**state-drive by default** — most flows call the harness's `run()` engine
verbs directly to set up scenarios fast.

Where this layer *does* cover real input: `packages/testkit/src/harness/inputDriver.ts`'s
`driveInputAt()` dispatches a genuine bubbling `pointerdown → pointerup → click`
sequence at real client coordinates and hit-tests the topmost element there — no
`{ force: true }`, no `el.click()`. This exists specifically because of the
dead-menu-buttons incident (`docs/retros/insitu-testing-capability-notes.md`
item 3): an overlay swallowed real clicks while `el.click()`/engine calls
sailed through. The rule (`GameHarness` contract,
`packages/testkit/src/harness/contract.ts`): any verb representing user input
ships **both** flavors — `run()` (state-drive, for setup) and
`clientPoint()` (the accessor `driveInputAt` uses for a real-input assertion).
A verb with only `run()` is a setup shortcut, not an input test.

Covers: real DOM events, real hit-testing, real-click regressions — but only
inside desktop Chromium/WebKit via Playwright. Does not run on-device.

### 3. Device element-gated capture (`verify-device`)

`tools/verify-device` (`npm run verify-device -- --game <g>`) is the
on-device lane and the forcing function for AGENTS.md #7/#8 (see
`docs/AGENT-HANDOFF.md`, `docs/plans/2026-07-06-001-tooling-verify-device-plan.md`).
In order:

1. For a fresh scaffold, generate the Capacitor iOS shell once with
   `npx cap add ios` in `games/<g>` before device verification; `_template`
   commits only native inputs/config (`games/_template/native-resources/README.md`,
   `games/_template/capacitor.config.ts`), `create-game` only copies/substitutes
   files (`tools/create-game/src/create-game.mjs`), and
   `tools/verify-device/src/steps.mjs` hard-fails install when
   `ios/App/App.xcodeproj` is absent.
2. Build the harness bundle with the `allstates` insitu tour
   (`VITE_ENABLE_TEST_HARNESS=true VITE_INSITU_TOUR=allstates vite build`,
   `games/<g>/src/testing/insituTour.ts`) + `npx cap sync ios`
   (`tools/verify-device/src/steps.mjs`).
3. Build + `devicectl install` on a real connected iPhone (serial read from
   `xcrun devicectl list devices`, never hardcoded).
4. Run the committed XCUITest runner
   (`tools/verify-device/runner/VerifyDeviceRunner/InsituTourTests.swift`):
   launch the installed app by bundle id, **wait for an accessibility element**
   labelled `tourstate:<state>` before shooting each state, `XCTFail` loudly if
   a state never appears. This replaced a fixed-`sleep(6)` cadence that
   silently captured the wrong frame (the menu/level-as-settings mislabel,
   `docs/retros/fidelity-diff-mistakes-ledger.md`).
5. Diff device captures against the committed reference set
   (`games/<g>/refs/manifest.yaml`), primary verdict from a multi-model vision
   panel (`tools/verify-device/src/panel.mjs`), phash demoted to advisory.
6. Print a `docs/evidence/<date>-device-verify/grid.html` path + one-line
   PASS/FAIL/UNVERIFIED verdict.

There's also an explicit `--lane browser` fallback (never the default) for
when a phone isn't available — same capture discipline, but the grid is
stamped `DEVICE-UNVERIFIED` because safe-area/notch insets can't be checked
off-device.

Covers: real device build/install/launch, real screen rendering (safe-area,
WKWebView vs desktop Chromium divergence), state-accuracy of the capture
(never a wrong/stale frame).

### 4. Panel fidelity (visual judge)

The vision panel from layer 3 (step 5) is also the acceptance mechanism for
"does this look like the reference" work — `docs/architecture/reference-fidelity-harness.md`'s
tiered judge (pixel/SSIM → structural/real-click → Gemini/multi-model
judgment on must-match axes: layout, palette, chrome, typography, motion).
This is what a fidelity/port card (e.g. the marble_run v1→v2 port) closes out
against instead of an eyeballed screenshot comparison.

Covers: whether the *rendering* matches a reference, scored and logged, not
hand-waved.

## How a new game gets all four

`games/_template` ships the web/test/harness/reference scaffold for all four
layers, so a new game inherits the code-level contracts by construction. It is
not device-installable immediately after `create-game`: the native projects
(`ios/`, `android/`) are generated on demand from committed inputs/config
(`games/_template/native-resources/README.md`, `games/_template/capacitor.config.ts`),
`tools/create-game/src/create-game.mjs` only copies/substitutes template files,
and `tools/verify-device/src/steps.mjs` requires `npx cap add ios` before
build/install can proceed.

- `tests/unit/smoke.test.ts` + `vitest.config.ts` — layer 1, green from the
  template's first commit.
- `tests/e2e/boot.spec.ts` + `playwright.config.ts` — layer 2 skeleton; a
  port grows it into the game's real smoke flow and adds `clientPoint()`
  accessors as it adds interactive verbs.
- `src/shell/harness.ts` (`createTemplateHarness`) — implements
  `@fabrikav2/testkit/harness`'s `GameHarness` contract with placeholder
  verbs. A port replaces the placeholders with real engine calls but keeps
  the shape: `snapshot()` (scene/status/inputReady), `gotoState`/`startLevel`/
  `sagaNodes`/cheats, the typed `verbs` extension point (both flavors),
  solver-bound `winLevel`/`failLevel`, optional `capture`/`perf`/`drainEvents`.
  This is what layers 2-4 all drive against — a game without it is not
  testable by construction, and `tools/audit` enforces its presence.
- `refs/` (manifest + art/video/notes dirs) — the reference-fidelity contract
  a port's card ships against, consumed by layer 3/4.
- `capacitor.config.ts` + `native-resources/` — the committed native-shell
  inputs. Run `npx cap add ios` before the first layer-3 device install so
  `ios/App/App.xcodeproj` exists (`games/_template/native-resources/README.md`,
  `games/_template/capacitor.config.ts`, `tools/verify-device/src/steps.mjs`).

### The required-harness contract's role

`packages/testkit/src/harness/contract.ts`'s `GameHarness<GameVerb>` is the
single typed contract every game implements against — it's what turns
"drive this game" from bespoke per-game glue (marble_run's original 140-line
ad-hoc `TestHarness`) into one reusable driver
(`packages/testkit/src/harness/inputDriver.ts`) plus per-game coordinate
accessors. It is the load-bearing seam between layers: layer 2's real-click
tests, layer 3's `allstates` tour and `driveTo(state)`, and layer 4's capture
all go through this one contract, so a game that implements it once gets all
three testing layers above unit tests for free. Enforcement is dual:
card-writing checklist (a feature without verbs/states is unreviewable) and a
`tools/audit` structural check that a game workspace exports the contract
surface.

### verify-device as the close-out

`docs/AGENT-HANDOFF.md` names `verify-device` (layer 3) as the **required**
close-out for any on-device/UI change, structurally enforced (not just
convention): a Stop-hook blocks a "done"/"verified"/"looks right" claim on a
visual-touching diff unless there's a fresh `panel.json` newer than the
changed files, and a merge-gate hard-fails the same check at landing time.
For a game card, "device element-gated capture" (layer 3) IS the mechanical
proof that AGENTS.md #7/#8 ("verify honestly", "fail visibly") is satisfied
for that change — not a subjective call.

## The honest gap: state-drive vs real device input

Layers 2-4 all drive the game **through the harness**, not through the
device's actual touch input path:

- Layer 2's real-click coverage (`driveInputAt`) is real-input-accurate, but
  browser-only — desktop Chromium/WebKit, not WKWebView on a phone.
- Layer 3's `allstates` tour is driven by the harness's own `driveTo(state)`
  (an in-page JS call), confirmed via `snapshot()`. The XCUITest runner does
  **not** dispatch any tap — it only *waits* for an accessibility marker
  (`tourstate:<state>`) that the JS tour publishes as it drives itself, then
  screenshots. Read literally: `InsituTourTests.swift` never calls
  `.tap()` on anything. It watches state changes; it does not cause them.
  This is intentional for what it was built for (guaranteeing the captured
  frame matches the stamped state, killing the sleep-cadence bug) — but it
  means device verification never exercises "does a physical/simulated tap
  at the game's own reported coordinates reach the intended control and
  produce the right state transition on-device."
- Layer 4's panel scores rendering fidelity of the frames layer 3 captured.
  It inherits the same blind spot: it can flag "this doesn't look like the
  reference," never "this doesn't respond to a real tap on this device."

So today, a game can pass all four layers — green unit tests, green
real-click e2e in the browser, a clean device-verify grid, a high panel
fidelity score — while a control on the actual phone doesn't react to a
finger tap. This is exactly the class of bug the dead-menu-buttons incident
found in the browser (`insitu-testing-capability-notes.md` item 2-3): "on-device
input remains unverified" was flagged there in 2026-07-06 and nothing has
closed it since; `verify-device`'s XCUITest runner was built to fix capture
timing, not to add device input coverage. Restated precisely: **the harness
state-drives; it has never confirmed a real device tap lands on the right
target.**

## Proposal: minimal behavioral-device smoke (not implemented by this card)

Add one XCUITest that drives at least one real tap and checks its effect via
the existing state contract, instead of only watching for tour markers:

1. Extend the harness contract's existing `clientPoint()` accessors (already
   required on every input-representing verb, `contract.ts`) so the value is
   also queryable from native XCUITest — e.g. publish the currently-relevant
   verb's `clientPoint()` as a hidden accessibility element's label (the same
   `#__tourstate__`-style bridge the tour marker already proves works: JS →
   WKWebView a11y tree → XCUITest can read it).
2. A new XCUITest (sibling to `InsituTourTests`, e.g. `BehavioralTapTests.swift`)
   that: launches the app, drives to a known state via the existing tour/
   `driveTo` bridge (setup, state-drive is fine here), reads the published
   `clientPoint`, issues a **real `XCUICoordinate.tap()`** at that point
   converted to device screen coordinates, then re-reads `snapshot()` (already
   bridged the same way the tour publishes state) and asserts the expected
   transition occurred (e.g. `inputReady` verb's target state changed, or a
   score/counter incremented).
3. Wire it as an additional, separate test target/invocation from
   `tools/verify-device` (own flag, e.g. `--behavioral-smoke`) so it doesn't
   change the default capture path's timing or grid — it's an addable gate,
   not a rewrite of the existing element-gated capture.
4. Scope to ONE verb for the smoke (e.g. the primary "tap to advance" action
   every game has) rather than enumerating every verb — the point is closing
   the "no real tap ever verified on device" gap, not full device-input
   coverage in one pass.

This is a proposal only. It reuses the existing contract (`clientPoint()`,
`snapshot()`) and existing native/JS bridge pattern (`tourstate:<state>`
accessibility element) rather than inventing new plumbing — the follow-up
card should scope the native-side element-publishing change and one solver-
independent verb to smoke-test first.
