---
title: "testkit: GameHarness contract + SharedShellDriver + observation collectors (verbs drive, collectors witness)"
date: 2026-07-06
trello: https://trello.com/c/QeubhcgR
card: QeubhcgR
stage: brainstormed
depends_on: 6QcUojYp
status: requirements-locked
---

# testkit GameHarness contract + drivers + collectors — requirements

Grounded read of the current tree (this worktree). Every file:line below was
opened and verified, not trusted from the card. This card **formalizes what
marble_run built organically** (`games/marble_run/src/shell/App.ts:578
harness()`) into a portfolio contract, and closes named gaps from
`docs/retros/insitu-testing-capability-notes.md`. It is a **type-and-scaffold**
card — additive contracts, one new sink, additive `ui` hooks, one new audit
linter, a template stub — verified by `typecheck`/`test:unit`/`audit`, not by
device runtime (which stays a downstream gap; see §4).

## 0. Where the ground truth is today (what already exists)

- **Organic in-game harness** — `games/marble_run/src/shell/App.ts:578-614`
  returns an **untyped** `Record<string, unknown>` with:
  `gotoMenu`, `startLevel(id)`, `tapCell(x,y)`, `showHint()`,
  `cellClientPoint(x,y)`, `setAnimationSpeed(m)`, `snapshot()`, `sagaNodes()`,
  `solveStep()`, `unlockAll()`, `grantCoins(coins)`. Exposed on
  `window.__MARBLE_RUN_HARNESS__` (`games/marble_run/tests/e2e/play.spec.ts:17`).
  **This is the shape to standardize.** Note two verb flavors already coexist:
  `tapCell` (state-drive: engine call) vs `cellClientPoint` (returns real client
  coordinates so a test can dispatch a real pointer event — the input-drive
  seed).
- **Test-runner side already in testkit** — `packages/testkit/src/playwright/`
  has the `window`→harness bridge (`harness.ts`:
  `waitForHarness`/`readHarness`/`callHarness`/`pollHarness`) and page-object
  navigation (`pageObject.ts`: `gotoAndWaitForHarness`, `waitForSceneActive`).
  **The gap is the OTHER side**: there is no shared *type* for what the in-game
  `harness()` must return. Each game hand-rolls it untyped.
- **Analytics facade + sink abstraction** — `packages/sdk/src/analytics/`:
  `sink.ts` (`AnalyticsSink { name; emit(event); flush?() }`), `analytics.ts`
  (`createAnalytics<GameEvent>` facade, the **generic-union extension point** the
  card wants the harness verbs to mirror), `console-sink.ts` (the model to copy
  for a new sink), `index.ts` (the barrel every export must be added to).
  `AnalyticsEvent` envelope = `{ name, params, timestamp, sessionId, env }`
  (`contract.ts`, re-read via `analytics.ts:119-125`).
- **ui hooks primitive** — `packages/ui/src/Button.ts:38-56 buildButtonElement`
  already supports `opts.dataAction` → `button.dataset.fabAction`
  (`Button.ts:51`). But it is **optional**, and today only **3 hook names exist
  in the whole `ui` package**: `data-fab-action` (HomeMenu play/settings/shop),
  `data-fab-economy-anchor`, `data-fab-economy-target`. Most interactive
  components (`PauseOverlay`, `ResultCard`, `SettingsPage`, `ShopPage`,
  `ToggleRow`, `ModalShell` close) render clickable elements with **no stable
  hook**. marble_run's real-click e2e already depends on these
  (`games/marble_run/tests/e2e/menu-clicks.spec.ts:18,41,48`).
- **Audit harness** — `tools/audit/src/cli.js` runs a `LINTERS` array; each
  linter returns `{ violations }`; a violation with `severity: 'warn'` is
  **reported but non-failing** (`cli.js:64-88`). This is the exact WARN-first
  mechanism the card's hook-check must reuse. Fixtures live under
  `tools/audit/test/fixtures/<linter>/{pass,fail}/`.
- **Template** — `games/_template/game.config.ts` declares
  `screens: ["HomeMenu"]` and `analyticsEvents: [...]` (the **single source of
  truth** for "what states exist", per CONDUCTOR comment (5)); `src/main.ts
  bootGame()` stands up the kernel flow machine. There is **no `harness.ts`
  stub** yet.
- **Seeded RNG** — `packages/kernel/src/rand.ts:7 mulberry32(seed)` is the kernel
  seeded generator; the template stub must document that games route randomness
  through it (CONDUCTOR comment (6); harness doc `reference-fidelity-harness.md`
  forced-change #3).

## 1. Constraints (hard)

- **v1 is READ-ONLY.** FTD's `recordRevealFrame` (perf precedent) and its
  140-line bespoke `TestHarness` are cited as prior art — do not edit v1.
- **Additive only** in `packages/sdk` and `packages/ui`: the ring-sink is a NEW
  file beside the existing sinks; `ui` edits are **new `data-fab-*` attributes
  only** — no behavior/markup restructuring, no renames.
- **Contract-and-scaffold, not runtime.** AC is `typecheck && test:unit &&
  audit`. On-device `capture()`/`collectRun()` runtime is out of reach this card
  (ledger gap 1 has no wired path — §4); ship the **contract + browser path +
  typed device-path stub**, and say so honestly.
- **The dead-menu-buttons lesson is load-bearing**: verbs that represent user
  input MUST offer an **input-drive** flavor (dispatch real pointer events at
  client coordinates — no `force`, no `el.click()`). See
  `insitu-testing-capability-notes.md` items 2-3.
- **The wrong-package near-miss rule**: the snapshot envelope MUST stamp
  package/app id + build version so a capture can never be silently attributed to
  the wrong installed variant (`insitu-testing-capability-notes.md` incident
  2026-07-06).
- ONE Trello column of work; `twf` handoff between stages. No PRs.

## 2. What this card ships (scope, in card order)

### 2.1 GameHarness contract (`packages/testkit`, new sub-surface)

A shared TYPE (not an implementation) for what an in-game `harness()` returns:

- **Standard core** (from the marble_run surface, generalized): `gotoState(state)`
  / `startLevel(id)` / `snapshot()` / `sagaNodes()` + cheats (`unlockAll()`,
  `grantCoins()`). `state` should be keyed to `gameConfig.screens` (§2.6 seed).
- **Typed game-verb extension point**: a generic union, the **same pattern as
  `Analytics<GameEvent>`** (`analytics.ts:68`) — `GameHarness<GameVerb extends
  string = never>` so a game declares its extra verbs typed without forking the
  core.
- **Two flavors per input-representing verb**:
  - `state-drive` — engine call, for setup (marble_run `tapCell`,
    `App.ts:582`);
  - `input-drive` — the harness returns the **client coordinates** of the target
    (marble_run `cellClientPoint`, `App.ts:584`) so the test-runner side
    dispatches a **real** pointer event there. The contract standardizes the
    `*ClientPoint`-style accessor as the input-drive half.
- **Home decision (OPEN, §4):** new subpath, likely
  `@fabrikav2/testkit/harness` (`src/harness/`), added to
  `packages/testkit/package.json exports` alongside `./playwright`, `./debug`,
  `./testing`.

### 2.2 Observation collectors (witness side)

- **(a) Snapshot envelope** — wrap the game's `snapshot()` in a stamped envelope:
  `{ fingerprint, ts (monotonic), buildVersion, packageId }`. `packageId` +
  `buildVersion` are the wrong-package guard (§1). This is a testkit helper +
  type; the game supplies the inner fingerprint (marble_run `snapshot()` is the
  input, `App.ts:604`).
- **(b) `capture()`** — self-screenshot compositing canvas+DOM → PNG. **Browser
  path** returns the PNG via the harness (playwright reads it), closing ledger
  gap 1's browser option. **Device debug builds** write to the app documents dir
  (pullable via adb/devicectl). SCOPE NOTE: the device write is a **typed stub +
  documented contract** this card — the wired pull path does not exist (§4).
- **(c) `drainEvents()`** — a **`RingBufferSink`** at
  `packages/sdk/src/analytics/ring-sink.ts` (+ `ring-sink.test.ts`). Implements
  `AnalyticsSink` (`sink.ts:15`); `emit` pushes into a bounded ring; a
  `drain()`/`snapshot()` accessor returns the buffered `AnalyticsEvent[]` so
  tests assert event semantics. Model: `console-sink.ts`. Export from
  `analytics/index.ts` (the "fence includes it" note = the additive-scan audits
  must see the new file).
- **(d) `perf()`** — fps buckets / worst-frame. Precedent: FTD
  `recordRevealFrame` (v1, read-only, cited only).

### 2.3 `collectRun()`

Bundle screenshots + snapshots + event trace + perf into a **timestamped run
dir** matching the `evidence/<date>-<topic>/` shape
(`games/_template/evidence/README.md`). Because the browser cannot write
arbitrary fs, the split is: **harness returns the artifacts**, the **test-runner
side (testkit playwright) assembles the dir**. AC is the **dir-shape unit test**,
not a live capture.

### 2.4 SharedShellDriver (`packages/testkit`)

Page objects over `packages/ui` stable hooks covering menu / settings / shop /
result / pause navigation for **every** game (built on the existing
`pageObject.ts` primitives). Depends on §2.5 hooks existing.

### 2.5 `data-fab-*` hook coverage + audit check

- **Rule**: every interactive `ui` component exposes a stable `data-fab-*` hook.
  Add the **missing** hooks (additive attribute-only edits) to the components
  enumerated in §0 (`PauseOverlay`, `ResultCard`, `SettingsPage`, `ShopPage`,
  `ToggleRow`, `ModalShell` close, etc.) — using the existing
  `Button.dataAction` seam where a `ui` Button is used.
- **New audit linter** (`tools/audit/src/hooks.js` + entry in `cli.js` LINTERS +
  `tools/audit/test/fixtures/hooks/{pass,fail}/`). **WARN-first** via
  `severity: 'warn'` (`cli.js:64`) so it reports without breaking the gate until
  coverage lands. It is the `no-literals`-style structural check the card asks
  for.

### 2.6 Seed-from-config helper + template stub

- **(5) seed-from-config** — a testkit helper deriving the refs/manifest state
  list from `gameConfig.screens` (`games/_template/game.config.ts:screens`), so
  "what states exist" has ONE source of truth (CONDUCTOR comment (5);
  `reference-fidelity-harness.md` Birth bullet).
- **(6) template `harness.ts` stub** — `games/_template/src/shell/harness.ts`
  implementing the §2.1 contract shape with placeholder verbs, **noting the
  seeded-rand rule** (route randomness through `kernel mulberry32`, seeded, for
  chaos reproducibility — CONDUCTOR comment (6)). Must compile under the template
  tsconfig.

## 3. Out of scope

- Any game logic change; any v1 edit.
- Wiring a real on-device screenshot pull path (ledger gap 1 stays open — this
  card ships the browser path + device stub only).
- Retrofitting marble_run onto the new contract (that is the sibling card
  "marble_run: adopt GameHarness…", visible in `twf sitrep`).
- `tools/refcap` / `tools/fidelity-judge` (separate build-order cards in
  `reference-fidelity-harness.md`).
- CI matrix decision for chaos/e2e (harness doc forced-change #4, OPEN, Batu).

## 4. Open questions for the plan stage

1. **In-game contract home & export** — new `packages/testkit/src/harness/`
   subpath (`@fabrikav2/testkit/harness`) vs folding into an existing subpath.
   The in-game contract is a NEW consumer class (game imports it) distinct from
   the playwright test-runner helpers; confirm the boundary so a game shell can
   import the type without pulling `@playwright/test` types.
2. **Typed two-flavor verbs** — how the generic `GameVerb` union expresses BOTH
   state-drive and input-drive halves in one type without forcing every game to
   hand-write coordinate accessors. Decide the naming convention
   (`tapCell`/`cellClientPoint` → generalized `<verb>`/`<verb>ClientPoint`?).
3. **`capture()` / `collectRun()` browser↔runner split** — the browser can't
   write a run dir; the harness must return blobs and the testkit playwright
   layer assembles the dir. Confirm the artifact-transfer shape and that the AC
   unit test targets dir-shape, not a live browser capture.
4. **Device path honesty** — `capture()` device-side has NO wired pull path
   (ledger gap 1). Plan must ship a typed stub + doc contract and **flag the
   unwired device path as a known gap**, not claim device capture works.
5. **Audit hook-check heuristic** — what mechanically defines an "interactive
   component" (`addEventListener('click')`, `<button>`, `role="button"`)? Name
   the detection + expected false-positive rate; WARN-first absorbs the initial
   noise.
6. **`ui` additive-edit blast radius** — adding `data-fab-*` to shared components
   touches every game's markup surface. Confirm attribute-only (no class/markup
   restructure) and that the no-duplication/deps audits still pass with the new
   `ring-sink.ts` file in the fence.

## 5. Verification (from the card AC; commands confirmed present at repo root)

```bash
npm run typecheck    # contract + driver + template stub typecheck
npm run test:unit    # ring-sink, snapshot envelope, collectRun dir-shape
npm run audit        # node tools/audit/src/cli.js — hook-check fixtures pass/fail
```

Done bar: contract + SharedShellDriver typecheck; unit tests green for ring-sink,
envelope, and `collectRun` dir shape; template `harness.ts` stub compiles; audit
hook-check WARN-first with pass/fail fixtures. Device `capture()` shipped as a
typed, documented stub with the unwired path flagged (not claimed working).
