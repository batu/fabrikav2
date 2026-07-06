---
title: "marble_run: adopt GameHarness fully — game verbs, chaos test, collectRun evidence (first consumer)"
date: 2026-07-06
trello: https://trello.com/c/dcEkgvae
card: dcEkgvae
stage: brainstormed
depends_on: QeubhcgR
status: requirements-locked
---

# marble_run adopts GameHarness fully — requirements

Grounded read of the current tree (this worktree, main @ 3b18a95). Every
`file:line` below was opened and verified, not trusted from the card. This is
the **first consumer** card for the `GameHarness` contract that landed in
`packages/testkit` from the sibling card QeubhcgR
(`docs/brainstorms/2026-07-06-testkit-gameharness-contract-drivers-collectors-requirements.md`).
The contract card shipped types + collectors + a runner-side driver but
deliberately did **not** retrofit any game (that brainstorm §3, line 184). This
card does the retrofit on marble_run and, in doing so, proves the contract by
producing the **evaluation input for the next card** (KEghp3x4 — "Harness
evaluation").

It is a **tests-and-harness-file card**: the only product edits allowed are the
in-game harness surface and the game's `game.config.ts`/shell glue needed to
implement the contract; everything else is under `games/marble_run/tests/**`.
**No gameplay/engine logic changes** (card Files line).

## 0. Where the ground truth is today (what already exists)

### 0.1 The landed contract (what marble_run must now implement)

- **`GameHarness<GameVerb extends string = never>`** —
  `packages/testkit/src/harness/contract.ts:114-144`. Required members:
  `gotoState(state: string): void` (`:118`), `startLevel(id): void` (`:120`),
  `snapshot(): unknown` (`:122`), `sagaNodes(): readonly (string|number)[]`
  (`:124`), `unlockAll(): void` (`:128`), `grantCoins(amount): void` (`:130`),
  **`readonly verbs: Record<GameVerb, GameVerbHandler>`** (`:135` — the typed
  game-verb extension point), and optional `capture?()` (`:139`), `perf?()`
  (`:141`), `drainEvents?()` (`:143`).
- **`GameVerbHandler<Args>`** — `contract.ts:43-48`: the two-flavor verb.
  `run(...args): unknown` is **state-drive** (engine call, setup);
  `clientPoint?(...args): ClientPoint` is **input-drive** (returns client
  coordinates so the runner dispatches a *real* pointer event). `ClientPoint =
  { x, y }` (`contract.ts:22-25`).
- **Import boundary**: a game shell imports the *types* from
  `@fabrikav2/testkit/harness` (playwright-free by construction —
  `packages/testkit/package.json exports "./harness"`). Runner-side helpers
  (SharedShellDriver, `collectRun`) live under `@fabrikav2/testkit/playwright`
  and import FROM harness, never the reverse.
- **Collectors, all real (unit-tested):** `RingBufferSink`
  (`packages/sdk/src/analytics/ring-sink.ts:44 createRingBufferSink`,
  `drain()`/`snapshot()`), `wrapSnapshot()` envelope
  (`packages/testkit/src/harness/envelope.ts:39`, stamps
  `{fingerprint, ts, buildVersion, packageId}` — the wrong-package guard),
  `captureCanvasPng()` (`packages/testkit/src/harness/capture.ts:29`, browser
  path real), `createPerfRecorder()` (`perf.ts:35`, fps buckets + worst frame),
  and `collectRun()` (`packages/testkit/src/playwright/collectRun.ts:37`, node
  fs writer over `buildRunLayout()`).
- **`SharedShellDriver`** — `packages/testkit/src/playwright/sharedShell.ts:64`.
  Structurally typed against Playwright `Page`; real clicks (no `force`) through
  `data-fab-*` hooks. Methods cover menu (`play/openSettings/openShop`), pause
  (`pauseResume/pauseSettings/pauseQuit`), result
  (`resultNext/resultRetry/resultMenu`), settings/shop
  (`toggle/restorePurchases/back`), plus an `action(name)` escape hatch. This is
  the ready-made engine for the real-click suite (§2.3).
- **Device capture is an explicit unwired throwing stub** —
  `capture.ts:59 captureToDeviceDocuments(): never` ("insitu ledger gap 1"). Only
  the **browser** capture path is real. This bounds what §2.4 can honestly claim.

### 0.2 marble_run's harness today (the thing being retrofitted)

- **Still the untyped organic `Record<string, unknown>`** —
  `games/marble_run/src/shell/App.ts:578 harness()`. It does **not** import or
  implement `GameHarness`; there is no `verbs` map, no
  `capture/perf/drainEvents`. Bound to `window.__MARBLE_RUN_HARNESS__` in
  `games/marble_run/src/main.ts:46`, gated by `TEST_HARNESS_ENABLED`.
- Verbs it returns (`App.ts:580-600`): `gotoMenu` (`:580`, no-arg — must
  reconcile with contract's `gotoState(state)`), `startLevel(id)` (`:581`),
  `tapCell(x,y)` (`:582`, state-drive), `showHint()` (`:583`),
  `cellClientPoint(x,y)` (`:584`, the input-drive twin of `tapCell`),
  `setAnimationSpeed(m)` (`:585`), `snapshot()` (`:586`), `sagaNodes()`
  (`:587`), `solveStep()` (`:588-596`, taps `engine.movableMarbles()[0].cell`),
  `unlockAll()` (`:597-599`), `grantCoins(coins)` (`:600`). Only
  `tapCell`/`cellClientPoint` are already a two-flavor pair.
- **Snapshot fields** (`GameController.snapshot()`
  `games/marble_run/src/game/GameController.ts:790-806`, wrapped by
  `App.ts:604-614`): `hearts` (`engine.hearts()`, `board.ts:101`), **`coins`**
  (`saveState.coins`), `inputReady`, `status`, `remaining`, `unlocked`,
  `animating`, `paused`, plus App-level `scene`/`reward`/`sagaNodeIds`. These are
  the chaos-invariant fields (§2.2).

### 0.3 Engine surface for the new game verbs

- **`movableMarbles(): readonly MarbleState[]`** —
  `games/marble_run/src/puzzle/marble-board/board.ts:126` =
  `allMarbles().filter(m => findPath(m) !== null)`. **There is no stored
  movable/blocked flag** (`MarbleState = {id,color,cell}`, `types.ts:59`);
  movability is *computed*. So "blocked marbles" = `allMarbles()` minus
  `movableMarbles()` — the adversarial `tapBlockedMarble` verb must derive it
  that way, not read a flag.
- Engine reached via `controller.engineRef(): BoardEngine | null`
  (`GameController.ts:~812`). `previewTap()` (`board.ts:135`) returns null for
  blocked cells — a natural assertion for the blocked verb (tap had no effect).
- **Seeded RNG**: `mulberry32(seed)` (`packages/kernel/src/rand.ts:7`, returns
  `() => number`), already pinned for marble_run in
  `tests/unit/rand-pinned.test.ts`. Chaos randomness routes through this.

### 0.4 Existing tests + evidence conventions

- `games/marble_run/tests/e2e/menu-clicks.spec.ts` — the P1a dead-buttons
  regression guard: real `locator.click()`, no harness, no force. The real-click
  suite (§2.3) generalizes this to every screen via `SharedShellDriver`.
- `tests/e2e/play.spec.ts` — menu→level→terminal loop via
  `window.__MARBLE_RUN_HARNESS__` + `@fabrikav2/testkit/playwright`.
- `tests/unit/{game-config,rand-pinned,sdk-wiring}.test.ts` — vitest.
- `games/marble_run/playwright.config.ts` — extends
  `configs/playwright.base.ts`, `testDir: tests/e2e`, webServer `npm run dev`
  port 5210. `package.json` scripts: `test:unit: vitest run`, `e2e: playwright
  test`. `@fabrikav2/testkit` is already a devDependency.
- `games/marble_run/game.config.ts:14 screens: ['HomeMenu','SagaMap','Settings',
  'ResultCard','PauseOverlay','Toast','ConnectivityIndicator']` — the source of
  truth for reachable states; `seedStatesFromConfig(gameConfig)`
  (`packages/testkit/src/harness/seedFromConfig.ts:24`) bridges it to
  `gotoState` targets.
- `games/marble_run/evidence/` already exists with three dated dirs
  (`2026-07-06-fixed/`, `-v1v2-fidelity/`, `-v2-screens/`). New run goes in
  `evidence/2026-07-06-harness-first-run/` per
  `games/_template/evidence/README.md` (`<date>-<topic>/`), matching
  `buildRunLayout()`'s `${date}-${topic}` dir name (`runLayout.ts:104`).

## 1. Constraints (hard)

- **No gameplay/engine logic changes.** Edits limited to the harness surface
  (`App.ts:578-614` / an extracted `src/shell/harness.ts`), `game.config.ts`
  glue if needed, and `games/marble_run/tests/**`. `board.ts`, `GameController`
  gameplay methods, puzzle logic: read-only.
- **Additive contract adoption.** Implementing `GameHarness` must not drop any
  verb `play.spec.ts` / `menu-clicks.spec.ts` currently rely on — either keep
  the legacy window keys working or update the specs in the same card (they are
  test files, in scope). Prefer keeping the organic verbs reachable and *adding*
  the typed `verbs` map + collectors, so nothing regresses.
- **Real input, not synthetic.** Every new user-input verb MUST offer the
  input-drive (`clientPoint`) flavor and the real-click suite MUST dispatch real
  pointer events / `locator.click()` with default actionability — no `force`, no
  `el.click()`. This is the load-bearing dead-buttons lesson
  (`insitu-testing-capability-notes.md` items 2-3).
- **Chaos must be reproducible by seed.** All random verb selection routes
  through `mulberry32(seed)`; the seed is logged so a red run replays exactly
  (card AC: "reproducible by seed").
- **Honesty on device capture.** `collectRun` evidence uses the **browser**
  capture path only; the device path is an unwired stub (`capture.ts:59`). The
  evidence artifact and any claim in it must say "browser/Chromium capture", not
  "on-device".
- **v1 READ-ONLY. No PRs. ONE column; twf handoff between stages.**

## 2. What this card ships (scope, in card order)

### 2.1 Retrofit marble_run's harness to the contract + game verbs

- Make the in-game harness satisfy `GameHarness<GameVerb>` from
  `@fabrikav2/testkit/harness`, with `GameVerb` = the marble_run verb union
  (at least `'tapUnlockedMarble' | 'tapBlockedMarble'`, plus any existing
  input verbs promoted into the `verbs` map, e.g. `tapCell`). `run` is the
  state-drive engine call; `clientPoint` returns the target cell's client
  coordinates (reuse `controller.cellClientPoint`, `App.ts:584`).
  DECISION (plan): extract to `games/marble_run/src/shell/harness.ts` (mirrors
  the template stub `games/_template/src/shell/harness.ts`) vs. type in-place in
  `App.ts`. Extraction is cleaner but is a bigger diff; either is "the harness
  file".
- **`tapUnlockedMarble()`** — pick a random marble from
  `engine.movableMarbles()` (`board.ts:126`); `run` taps its cell (state-drive),
  `clientPoint` returns that cell's client point (input-drive). Legal verb.
- **`tapBlockedMarble()`** — pick a random marble from `allMarbles()` NOT in
  `movableMarbles()` (adversarial / illegal input). Same two flavors. Asserts a
  tap on a blocked marble is a no-op (`previewTap` null, `board.ts:135`), never a
  crash.
- **`solveStep` carried** — keep the existing deterministic solver verb
  (`App.ts:588`) available for the chaos test's "make progress" moves and for
  `play.spec.ts`.
- Wire the collectors the game can supply: `snapshot()` fingerprint through
  `wrapSnapshot()` (stamp packageId/buildVersion), optional `drainEvents()` via
  a `RingBufferSink` attached to the game's analytics, optional `perf()` via
  `createPerfRecorder()`, optional `capture()` via `captureCanvasPng()` on the
  game's canvas.

### 2.2 Chaos e2e (seeded, reproducible)

- Drive N random verbs (legal `tapUnlockedMarble`/`solveStep` + illegal
  `tapBlockedMarble` + navigation) chosen via `mulberry32(seed)`, asserting
  **snapshot invariants after every step**:
  - `hearts` never negative (`snapshot.hearts`, `board.ts:101`);
  - `coins` conserved except across known economy events — i.e. coins only
    change when an economy event fired (reward/purchase); assert monotonic or
    event-justified deltas, not silent drift;
  - **no crash** (harness stays callable; `readHarness` keeps resolving);
  - **`inputReady` recovers** — after any transient `animating`/`spawning`
    window, `snapshot.inputReady` returns true within a bounded poll (the game
    never wedges).
- Seed printed on start; failure message includes the seed + step index so the
  run replays deterministically (AC: "reproducible by seed").

### 2.3 Real-click coverage (every visible control, every screen)

- Using `SharedShellDriver` (`sharedShell.ts:64`) drive **every** visible
  control on menu / settings / pause / result / shop with real clicks (default
  actionability, no force), asserting the real DOM/state effect of each — the
  generalization of `menu-clicks.spec.ts`.
- **Precondition (verify early):** marble_run's rendered screens must actually
  emit the `data-fab-*` hooks `SharedShellDriver` selects (pause
  `pause-resume/-settings/-quit`, result `result-next/-retry/-menu`, `back`,
  `shop-restore`). These were added to `packages/ui` in the sibling card; §4.1
  is the open question of whether marble_run reaches every screen through those
  UI components or renders any control locally (which would need a hook added —
  and that edit would be in `packages/ui`, i.e. **out of this card's Files
  scope**, so it must be caught, not silently worked around).

### 2.4 One `collectRun()` producing the evaluation artifact

- Produce `games/marble_run/evidence/2026-07-06-harness-first-run/` via
  `collectRun()` (`collectRun.ts:37`): screenshots of **all reachable states**
  (drive each `game.config.ts` screen, browser `capture()`), the event trace
  (`drainEvents()` from the ring sink), and perf (`perf()`), assembled by the
  runner into the dated dir shape.
- This artifact is the **evaluation input for KEghp3x4**. It must be **committed
  to `evidence/`** (AC). Label every capture "Chromium/browser capture" per §1
  honesty rule.

## 3. Out of scope

- Any engine/gameplay logic change; any v1 edit; any `packages/**` edit (the
  contract, collectors, driver, and `data-fab` hooks already landed — if marble
  needs a missing hook, that is a **blocker to surface**, not an in-card edit).
- Wiring on-device capture (ledger gap 1 stays open — browser path only).
- `tools/refcap` / `tools/fidelity-judge` and the Gemini visual judge
  (`reference-fidelity-harness.md` — separate cards).
- Grading the harness / acting on the evidence — that is the next card KEghp3x4.
- Visual-regression baselines / pixel-diff (ledger items 4-5).

## 4. Open questions for the plan stage

1. **`data-fab-*` hook reachability in marble_run's actual screens** — does
   marble_run render pause/result/shop/settings through the `packages/ui`
   components that now carry the hooks, or does it render any control locally
   without a hook? If the latter, the fix lives in `packages/ui` (out of Files
   scope) → surface as a blocker. Enumerate every control the real-click suite
   must reach and confirm its hook exists BEFORE writing the suite.
2. **`run`/`clientPoint` agreement under randomness** — `tapUnlockedMarble()`
   picks a *random* marble, but the contract's `clientPoint(...args)` must return
   the coordinates of the *same* marble `run(...args)` taps, or input-drive and
   state-drive diverge. Options: (a) verb is pure over a seeded RNG so both
   compute the identical target; (b) a "select target, then act" split where the
   test picks the marble and passes its cell as the arg (`tapUnlockedMarble(cell)`
   with the random selection done test-side). Decide the shape so the two
   flavors can never disagree.
3. **Harness home** — extract `games/marble_run/src/shell/harness.ts` (mirror the
   template stub) vs. type the existing `App.ts:578` closure in place. Weigh diff
   size vs. the card's "harness file" framing.
4. **Coins-conservation oracle** — precisely define "economy events" for the
   chaos invariant: which analytics events / snapshot transitions legitimize a
   coin delta (reward grant, IAP, purchase)? Without a crisp list the invariant
   is either too loose (misses drift) or too strict (false red on legit spend).
5. **Does Playwright run in the worker sandbox?** The sibling brainstorm + the
   `play.spec.ts` header note "the conductor executes it — Playwright doesn't run
   in the worker sandbox," yet Chromium **is** installed locally
   (`~/Library/Caches/ms-playwright/chromium-1228`, `npx playwright --version` →
   1.61.1). If e2e/`collectRun` cannot execute in-worker, the `worked`/evidence
   stage must either run it where it can or flag the AC (`npx playwright test` +
   committed evidence) as conductor-executed. Resolve before promising the
   evidence artifact is generated, not just coded.
6. **Legacy window-key compatibility** — keep `__MARBLE_RUN_HARNESS__` and the
   organic verbs working while adding the typed `verbs` map, or migrate
   `play.spec.ts`/`menu-clicks.spec.ts` to the new surface in the same card?
   Prefer additive to avoid regressing the two green specs.

## 5. Verification (from the card AC; commands confirmed at repo root)

```bash
npm run test:unit --workspace=games/marble_run    # vitest: harness-shape / verb unit tests
npx playwright test --config games/marble_run/playwright.config.ts  # chaos + real-click e2e
npm run typecheck                                  # harness now satisfies GameHarness<…>
```

Done bar: harness satisfies `GameHarness<GameVerb>` and typechecks; chaos test
green **and reproducible by a printed seed**; real-click suite green across
menu/settings/pause/result/shop with real (no-force) clicks; one `collectRun`
run committed under `games/marble_run/evidence/2026-07-06-harness-first-run/`
(screenshots of all reachable states + event trace + perf), labelled as
browser/Chromium capture. If Playwright cannot run in-worker (§4.5), the e2e +
evidence steps are flagged as conductor-executed rather than claimed done.
