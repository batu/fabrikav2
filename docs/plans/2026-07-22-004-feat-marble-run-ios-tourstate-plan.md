---
title: "feat: iOS platform + tourstate marker harness for Pixelsmith (marble_run)"
date: 2026-07-22
type: feat
origin: trello card MRV2-6 (no brainstorm doc)
trello: https://trello.com/c/rjVwGsxR
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# feat: iOS platform + tourstate marker harness for Pixelsmith (marble_run)

## Summary

Give v2 `games/marble_run` (1) an iOS-platform recipe compatible with this repo's uncommitted-`ios/` convention, and (2) a deterministic tour harness that can drive the app to each of ten Pixelsmith capture states and publish the `tourstate:<state>` accessibility marker **within 25 seconds of a cold launch**, so Pixelsmith `capture --state X --expect X` works against the installed app on the real iPhone.

---

## Problem Frame

Pixelsmith (`/Users/base/dev/appletolye/pixelsmith`) launches the installed app with **no arguments** and waits ≤25s for an accessibility element labelled `tourstate:<state>` (`capture.py`, generated `CaptureStateTests`). The existing `allstates` insitu tour (`@fabrikav2/testkit/testing` `maybeRunInsituTour`) walks states sequentially with an 11s dwell — only the first one or two states would ever appear inside 25s. Therefore the target state must be selected **at build time** (`VITE_INSITU_TOUR`) and driven **directly**, one state per build/sync. That per-state-build workflow is the operating assumption of this plan.

marble_run today has: the default 6-state `driveTo` harness (`src/testing/TestHarness.ts`), `maybeRunInsituTour` wiring in `src/bootstrap.ts`, `@capacitor/ios` in devDependencies, a `capacitor.config.ts` with `ios.contentInset: "never"`, and `native-resources/ios/App/App` (icons/splash/Info.plist) — but **no generated iOS project recipe, no signing injection, and none of the ten Pixelsmith states**.

### Requirements

- **R1** — App can publish `tourstate:<S>` within 25s of launch for each of: `home-fresh`, `level-map`, `gameplay-opener`, `gameplay-plugs`, `gameplay-voids`, `gameplay-teach`, `win`, `pause`, `shop`, `settings`, using the same marker mechanism as the FTD device-proof lane (`publishTourMarker`, hidden `#__tourstate__` element, `body[data-tour-state]`).
- **R2** — State selection is deterministic and baked at build time (`VITE_INSITU_TOUR=<state>`); `VITE_INSITU_TOUR=allstates` keeps working unchanged for `verify-device`.
- **R3** — iOS platform: `npx cap add ios` + `cap sync ios` works for marble_run, with `DEVELOPMENT_TEAM = 42L77JAX72;` injected after both `CODE_SIGN_STYLE = Automatic;` occurrences in `project.pbxproj` — as a committed idempotent script, since the generated `ios/` is never committed in v2 (see KTD-2).
- **R4** — Marker logic unit-tested; iOS live build is conductor-run (sandbox has no xcodebuild/keychain).
- **R5** — Scope fence: `games/marble_run/**` only. v1 sugar3d lacks tourstate entirely → reported in handoff SURPRISES, not edited here.

---

## Key Technical Decisions

- **KTD-1 — Single-state tour rides the existing testkit API; no testkit edits.** `maybeRunInsituTour` already accepts `{ script, states, snapshotMatchesState }` overrides. Bootstrap reads the requested script (`VITE_INSITU_TOUR` or `?insituTour=`); when it names one of the ten Pixelsmith states, call `maybeRunInsituTour(harness, { script: 'allstates', states: [<state>], ... })` — the tour then drives directly to that one state and publishes its marker immediately after confirmation (drive ≈2–6s, settle recheck 500ms — well inside 25s). `allstates` passes through untouched. This keeps the scope fence (no `packages/testkit` change) and reuses the exact FTD-proven marker path.
- **KTD-2 — Generated `ios/` stays uncommitted; the card's v1 recipe becomes a committed script.** The card says "same recipe as v1" (commit `cap add ios` output + hand-edit pbxproj), but v2's explicit convention (`native-resources/README.md`, FTD precedent, verify-device reapply step) is that `ios/` is a build artifact (v1 FTD checked in a 2.3GB tree — do not repeat). Resolution: commit `games/marble_run/scripts/ios-inject-team.mjs`, an idempotent script that injects `DEVELOPMENT_TEAM = 42L77JAX72;` after every `CODE_SIGN_STYLE = Automatic;` in `ios/App/App.xcodeproj/project.pbxproj`, plus an npm script chaining add/sync/inject. Local-vs-recent convention conflict resolved toward v2; flagged in the handoff.
- **KTD-3 — `gameplay-*` states map to designated levels via one committed config.** `gameplay-opener/plugs/voids/teach` are board-feature states (v1 vocabulary: plug caps / blocked-plug marks in `sugar3d/src/three/BoardScene.ts`; teach = tutorial; opener = level 1). v2 levels are still stubs (`public/levels/stub_level_*`, no `tags`), so the four states drive to designated level indices held in a single exported map (`PIXELSMITH_STATE_LEVELS`) in the new states module. When real level content lands (later MRV2 cards), only that map (or a future tags-based lookup) changes — the tour contract does not. Until then all four states capture stub gameplay; this is expected and noted in the handoff.
- **KTD-4 — New states are additive harness states via the existing `DriveToDeps.states`/`gotoState` extension point** (the same pattern FTD used for its `achievements`/`win-achievement` custom states in `games/find_the_dog/refs/manifest.yaml` + harness). `win`, `pause`, `settings` already exist; `home-fresh`, `level-map`, `shop` and the four `gameplay-*` states are new names layered over existing verbs (`gotoHome`+`resetSave`, home level-map view, `openPage('shop')`, `startLevel(n)`).

---

## High-Level Technical Design

```mermaid
flowchart LR
    A[cold launch] --> B{requested script\nVITE_INSITU_TOUR / ?insituTour=}
    B -- allstates --> C[maybeRunInsituTour\ndefault 6-state walk\n(verify-device lane, unchanged)]
    B -- pixelsmith state S --> D[maybeRunInsituTour\nscript:'allstates', states:[S]\npixelsmith predicates]
    D --> E[harness.driveTo(S)\nverbs: gotoHome / startLevel(map[S]) /\nopenPage / pause / winLevel]
    E --> F[publishTourMarker(S)\n#__tourstate__ aria-label\nbody[data-tour-state]]
    F --> G[Pixelsmith XCUITest sees\ntourstate:S ≤25s → screenshot]
```

Prose is authoritative; the diagram is orientation.

---

## Scope Boundaries

- **In scope:** `games/marble_run/**` only — testing harness, bootstrap, scripts, native-resources docs, unit tests.
- **Out of scope:** `packages/testkit` changes; editing fabrika v1 (sugar3d lacks tourstate — handoff SURPRISES item); running the live iOS build (conductor); real level content for plugs/voids/teach boards.
- **Deferred to Follow-Up Work:** tags-based level lookup once level `tags` are populated; adding the ten states to `refs/manifest.yaml` for verify-device parity (only when references for those states exist).

---

## Implementation Units

### U1. Pixelsmith state vocabulary + harness drive support

**Goal:** marble_run's harness can `driveTo` all ten Pixelsmith states.
**Requirements:** R1, R2 (state list), R5.
**Dependencies:** none.
**Files:** `games/marble_run/src/testing/pixelsmithStates.ts` (new), `games/marble_run/src/testing/TestHarness.ts`, `games/marble_run/tests/unit/pixelsmith-states.test.ts` (new).
**Approach:**
- New module exports `PIXELSMITH_TOUR_STATES` (the ten names, card order), `PIXELSMITH_STATE_LEVELS` (KTD-3 map: opener→1, teach/plugs/voids→designated stub indices), per-state predicates (`snapshotMatchesPixelsmithState`), and `isPixelsmithState`.
- Extend `createMarbleRunHarness`'s `driveDeps()` with `states` (defaults + pixelsmith names) and `gotoState(state)` handling the new names: `home-fresh` = `resetSave()` + `gotoHome()`; `level-map` = home with the level-map band visible (home shell already renders `.fab-levelmap-node`; predicate keys on home snapshot + a level-map-visible signal — add one to `driveSnapshot()` if not present); `shop` = `openPage('shop')` (extend the existing `openPage('shop'|'settings')` path; add a `shopOpen` snapshot field mirroring `settingsOpen`); `gameplay-*` = `startLevel(PIXELSMITH_STATE_LEVELS[state])` then same readiness predicate as `level`; `win`/`pause`/`settings` alias the existing states.
**Patterns to follow:** FTD custom-state extension (`DriveToDeps.states`/`gotoState`, `games/find_the_dog/refs/manifest.yaml` `driveTo:` entries); existing `marbleRunDrivePredicates` style in `TestHarness.ts`.
**Test scenarios:**
- Happy path: each of the ten states → `driveTo(state)` resolves `true` against a stubbed game and the matching predicate accepts the resulting snapshot (mirror the stub-snapshot approach of `tests/unit/insitu-tour.test.ts`).
- `home-fresh` calls `resetSave` before navigating; snapshot after shows home shell.
- `gameplay-plugs/voids/teach/opener` each call `startLevel` with their mapped index from `PIXELSMITH_STATE_LEVELS`.
- Edge: unknown state name → `driveTo` returns `false`, no throw.
- `shop` predicate rejects a snapshot with `settingsOpen: true` and vice versa (states are mutually distinguishable).
**Verification:** `npm run test:unit` (marble_run scope) green; typecheck green.

### U2. Bootstrap single-state tour selection + marker timing proof

**Goal:** A build with `VITE_INSITU_TOUR=<pixelsmith-state>` publishes `tourstate:<state>` well inside 25s of boot; `allstates` behavior unchanged.
**Requirements:** R1, R2, R4.
**Dependencies:** U1.
**Files:** `games/marble_run/src/bootstrap.ts`, `games/marble_run/tests/unit/insitu-tour.test.ts`.
**Approach:** In the `TEST_HARNESS_ENABLED` block, read the requested script (same sources `maybeRunInsituTour` uses: `VITE_INSITU_TOUR`, then `?insituTour=`). If it is a Pixelsmith state, call `maybeRunInsituTour(harness, { script: 'allstates', states: [state], snapshotMatchesState: snapshotMatchesPixelsmithState, saveProfile })` — with `saveProfile: null` for `home-fresh` (fresh save is the state's identity; the tour's own `resetSave` + default seed would fake progress) and the default profile otherwise. If it is `allstates` or absent, keep today's call verbatim.
**Execution note:** Prove the 25s budget in a unit test with fake timers before wiring anything else — that budget is the card's hard external contract.
**Test scenarios:**
- For each of the ten states: fake-timer run of the single-state tour publishes `#__tourstate__` with `aria-label="tourstate:<state>"` and `body[data-tour-state]=<state>` in < 25 000 simulated ms from tour start (drive stub resolves in ~2s).
- `insituTour=allstates` still walks the default six states (regression: existing test file continues to pass).
- No `insituTour` request → no marker element created.
- Failed drive (stub returns false) → marker published as `<state>-FAILED`, not the bare state (Pixelsmith must not screenshot a wrong state as success).
- `home-fresh` run does not seed the default save profile.
**Verification:** unit suite green; grep-level check that the `allstates` path is byte-identical in behavior.

### U3. iOS platform recipe: add-ios flow + signing injection script + docs

**Goal:** Conductor can produce a signed iOS project with one command chain; recipe is committed, generated `ios/` is not.
**Requirements:** R3, R4.
**Dependencies:** none (parallel with U1/U2).
**Files:** `games/marble_run/scripts/ios-inject-team.mjs` (new), `games/marble_run/package.json` (script entries), `games/marble_run/native-resources/README.md` (iOS section update), `games/marble_run/tests/unit/ios-inject-team.test.ts` (new).
**Approach:** Script reads `ios/App/App.xcodeproj/project.pbxproj`, inserts `DEVELOPMENT_TEAM = 42L77JAX72;` after **every** `CODE_SIGN_STYLE = Automatic;` line lacking a following team, idempotent on re-run, loud failure if the file or any `CODE_SIGN_STYLE` occurrence is missing. Add npm scripts: `ios:add` (`cap add ios && cap sync ios && node scripts/ios-inject-team.mjs`) and `ios:sync`. Document in `native-resources/README.md`: the per-state Pixelsmith build recipe (`VITE_ENABLE_TEST_HARNESS=true VITE_INSITU_TOUR=<state> vite build && cap sync ios`), the signing script, and that `ios/` is never committed. Team ID is a build-setting constant, not a secret (already committed in pixelsmith README and v1 recipes).
**Patterns to follow:** existing `games/marble_run/scripts/*.mjs` style; `tools/verify-device/src/steps.mjs` signing approach (it passes `DEVELOPMENT_TEAM` as an xcodebuild setting — the pbxproj injection additionally covers plain-Xcode/pixelsmith builds that don't go through verify-device).
**Test scenarios:**
- Fixture pbxproj with two `CODE_SIGN_STYLE = Automatic;` occurrences → both get the team line; second run is a no-op (byte-identical output).
- Fixture already containing `DEVELOPMENT_TEAM` → unchanged.
- Missing file / zero occurrences → non-zero exit with a clear message.
**Verification:** unit suite green. **Unverified in this card:** the live `cap add ios` + `xcodebuild` run — conductor must execute the first live build (sandbox lacks xcodebuild/keychain), per the card's own verification clause.

---

## Verification Contract

- `npm run typecheck`, marble_run unit tests, `npx eslint` on touched files — all green locally (worker-runnable).
- Marker-within-25s proven by fake-timer unit test (U2), not by device claim.
- Live iOS build + real-device Pixelsmith capture: **conductor-owned**, explicitly out of worker reach; stated in handoff REMAINING.

## Definition of Done

All three units landed on the card branch with green local checks; handoff cites FTD/testkit prior art reused (marker mechanism, custom-state pattern) and rejected (committing generated `ios/` — v2 convention wins); SURPRISES records that v1 sugar3d has no tourstate states and that gameplay-* states currently show stub levels.

## Open Questions / Assumptions

- **Assumption:** per-state rebuild (`VITE_INSITU_TOUR=<state>`) is the intended Pixelsmith workflow, since `capture` launches with no args and 25s cannot cover a sequential multi-state tour. If a single-build multi-launch flow is wanted later, it needs a persisted-state channel (follow-up card).
- **Assumption:** designated stub level indices are acceptable stand-ins for plugs/voids/teach until real level data lands (KTD-3); the mapping is one-line data.
- **Product Contract preservation:** n/a — no upstream brainstorm; contract bootstrapped from the Trello card.
