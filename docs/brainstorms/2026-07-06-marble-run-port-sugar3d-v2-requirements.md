---
title: "games/marble_run — port sugar3d onto v2 (gameplay + DOM shell + design/ layer) requirements"
date: 2026-07-06
trello: https://trello.com/c/9SbVZcm7
card: 9SbVZcm7
depends_on: f156Nyz1, TlFpa0ax, GjUg0sbk
stage: todo → brainstormed
status: requirements-locked
source_readonly: /Users/base/dev/appletolye/fabrika/games/marble_run/sugar3d
---

# games/marble_run — requirements & approach

Requirements/approach artifact for the `todo → brainstormed` transition. This is the
**pilot game port**: it is the first `games/*` workspace to exist, so it doubles as the
proof that the v2 substrate (kernel flow + `@fabrikav2/ui` screens + `@fabrikav2/sdk`
clients + the `design/` sheet layer + `tools/audit`) actually composes into a shippable
game. Everything before this card was infrastructure with no consumer; **this card is the
consumer**. No code is written at this stage — this doc front-loads the port verdicts,
the contracts that don't exist yet and must be authored here, and the divergences from the
card's assumptions that the research surfaced.

It provides: (1) the goal + inherited constraints, (2) the game-lifecycle → kernel-flow
wiring (the central integration), (3) the v2 game-folder layout with an audit-scope map,
(4) a per-module **port ledger** (copy-verbatim / copy-with-changes / import-from-package /
build-fresh) against the READ-ONLY v1 `sugar3d` tree, (5) the two contracts this card must
**author from scratch** (`game.config.ts` and the `design/{tokens.css,copy.ts,assets.ts}`
layer) because no v2 type or example exists yet, (6) the audio-port plan onto the SDK
AudioBus, (7) the test/e2e plan, (8) restated AC, and (9) the surprises the `worked` worker
must resolve.

## Goal

Stand up `games/marble_run` as a real, playable v2 workspace: the Three.js marble-sorting
gameplay ported off v1 `sugar3d`, its bespoke 728-line `dom.ts` + `App.ts` shell surfaces
**replaced** by `@fabrikav2/ui` screens driven through the kernel flow machine, audio/haptics
routed through `@fabrikav2/sdk`, and every design value (color/copy/asset) relocated into a
generated `design/` layer so the shell is literal-free and the audit passes.

AC (card): `npm run dev --workspace=games/marble_run` serves a playable menu→level→win/fail
loop with v2 screens; zero hex/copy literals outside `design/` (audit passes); vite build
green; unit tests for `game.config` + saga adapter. Verification:
`npm run typecheck --workspace=games/marble_run && npm run test:unit --workspace=games/marble_run
&& npm run build --workspace=games/marble_run && npm run audit`.

## Constraints (inherited, non-negotiable)

- **v1 is strictly READ-ONLY.** Seed everything from `/Users/base/dev/appletolye/fabrika/games/marble_run/sugar3d`;
  never edit it. Commits land only in `fabrikav2`.
- **No PRs, no deploys, no secrets** (conductor merges the branch). Advance exactly one column.
- **Audit rule (guardrail #2).** `tools/audit` (`npm run audit`) runs three linters; the
  one that constrains this card most is *no-literals*, and its scope is **`packages/ui/**`
  and `games/*/src/shell/**` only**. So: DOM **shell** code must carry zero hex/`rgb()`,
  zero >2-word DOM-sink copy strings, and zero asset-extension string literals — all of
  those resolve through `design/`. Gameplay `src/` (the Three.js renderer, `Constants.ts`,
  the puzzle module) and `design/` itself are **out of audit scope by construction** — the
  literal ban does not touch them. This dictates the folder split below.
- **Duplication gate (guardrail #3).** A `games/*` file may not *declare* an export whose
  name a `packages/*` entry already exports; re-exports sourced from `@fabrikav2/*` are
  allowed. Consequence: `mulberry32` (exported by `@fabrikav2/kernel`) is **imported, not
  copied**; the marble-board puzzle symbols (`BoardEngine`, `generateLevel`, …) are NOT
  exported by any v2 package, so copying them into the game is legal.
- **Declared deps only (guardrail #1).** Every `@fabrikav2/*` import and `three` must be in
  the game's own `package.json` (the *deps-declared* linter enforces this).
- **`depends_on` all satisfied** — verified landed on `main`:
  - `f156Nyz1` (ui screens: HomeMenu/SagaMap/PageShell/SettingsPage/ResultCard/PauseOverlay/PageStack) — commit `53d6dae`, merged at HEAD `731d893`.
  - `TlFpa0ax` (ui wave-B: `animateEconomyTransfer`, `resolveDomAnchorToCanvasPoint` canvas↔DOM bridge, `mountConnectivityIndicator`) — merge `bafb33f`.
  - `GjUg0sbk` (sdk: `createAudioBus`, `createHaptics`) — commit `bc57761`.

## The central integration — game lifecycle → kernel flow machine

The v1 game has **no state machine**: `App.ts` (725 lines) tracks a two-value
`ScreenName = 'Menu' | 'Game'` and layers win/fail/finale/settings/pause as ad-hoc DOM
modals. The port's spine is binding the real lifecycle onto `@fabrikav2/kernel/flow`, which
this card is the first real consumer of (the machine ships `@experimental` "quarantined").

**Corrected machine surface (SURPRISE S1 — the card's assumed shape is wrong).** The landed
`createFlowMachine(config)` (`packages/kernel/src/flow/machine.ts:147`) exposes **no
`subscribe` and no generic `transition(name)`**. You subscribe via `machine.events.on(...)`
(a `TypedEventEmitter`) and drive it with typed methods. Marble needs both optional states,
so it MUST opt in:

```ts
const machine = createFlowMachine({ optionalStates: ['levelSelect', 'paused'] });
```

States `Boot | Menu | LevelSelect | Playing | Paused | Complete | Failed`; methods
`start(levelId) | complete() | fail() | next(nextLevelId) | retry() | selectLevel() |
pause() | resume() | toMenu()`; guard `can(t)`; `dispose()`. `events` fire
`level:start | level:complete | level:fail | level:next | menu:enter`.

**Lifecycle mapping (v1 `App.ts` method → flow state → screen):**

| v1 trigger (`App.ts`) | Flow edge | v2 screen mounted on state-enter |
|---|---|---|
| constructor → `gotoMenu()` | `Boot → toMenu() → Menu` | **HomeMenu** (composes SagaMap) |
| "Levels" / open map | `Menu → selectLevel() → LevelSelect` | **SagaMap** |
| `onSelectLevel(current)` / `onPlay` → `startLevel(id)` | `LevelSelect|Menu → start(id) → Playing` | in-game HUD (gameplay `src/`) + BoardScene |
| `handleAbsorbed()` `change.won` → `showWin()` | `Playing → complete() → Complete` | **ResultCard** `variant:'win'` |
| `handleBlockedImpact()` `change.failed` → `showFail()` | `Playing → fail() → Failed` | **ResultCard** `variant:'lose'` |
| pause gear → `onPause` | `Playing → pause() → Paused` | **PauseOverlay** |
| `onResume` | `Paused → resume() → Playing` | (unmount PauseOverlay) |
| `onNext` (levelId < 20) | `Complete → next(nextId) → Playing` | next level |
| `onNext` (levelId ≥ 20) → `showFinale()` | `Complete → toMenu()` (finale is a screen, not a state) | **ResultCard** `variant:'win'` + finale copy |
| `onRetry` / `onRestart` | `Complete|Failed → retry() → Playing` | same level |
| `onBackToMenu` | `* → toMenu() → Menu` | HomeMenu |

**Load-bearing gotchas (confirmed in code):**
- **`selectLevel()` takes no argument** — it is only the `Menu → LevelSelect` edge. The
  actual pick is a separate `start(id)` edge from LevelSelect (SagaMap node tap). HomeMenu
  and SagaMap own different edges.
- **`next()` requires `nextLevelId` up front** (`machine.ts` `requireLevelId`). ResultCard's
  "Next" is handed the id as injected data — the shell computes it from the saga read-model;
  the screen never derives it. `ENDLESS_LEVEL_ID = 'endless'` exists (unused by marble).
- **Level ids are strings in the machine** (`start(levelId: string)`), but the puzzle engine
  and `LEVELS[]` use **1-based numbers**. The shell adapter coerces at the boundary
  (`String(n)` in / `Number(id)` out) — a small but real impedance point to centralize.
- **Guard double-fires** with `if (machine.can(t))` before firing (a double `complete()`
  throws `FlowMachineError`).
- **Win/fail/stars/streak are decided in the engine, not the view.** `BoardEngine.tap(cell)`
  returns a `TapChange` already carrying `won`/`stars` (rolled) or `failed`/`heartsLeft`
  (blocked). `BoardScene` fires `onAbsorbed`/`onBlockedImpact` only when the *animation*
  completes (in `tick`), so the shell's `complete()`/`fail()` calls are **animation-paced,
  not tap-paced**. Preserve this ordering — the flow transition happens in the callback, not
  at tap time.
- **Pause == boolean + settings modal in v1** (there was no dedicated pause overlay). v2 gives
  a real `Paused` state + `mountPauseOverlay`; the v1 `SettingsActionKey` union
  (`resume|close|restart|home|resetProgress`) is the reference for PauseOverlay's actions
  (Resume→`resume()`, Quit→`toMenu()`, Settings→push SettingsPage onto the PageStack).

**Back-stack / SettingsPage** are **not** flow states — they are `createPageStack()` overlays
(from `f156Nyz1`, already landed): SettingsPage opens over Menu or over Paused via
`pageStack.push(() => mountSettingsPage(...))`, and back/gesture-dismiss pops it. This keeps
the flow machine's lifecycle table untouched.

## v2 game-folder layout + audit-scope map

There is **no `games/_template` and `tools/create-game` is an unimplemented stub** (S4) — the
workspace is hand-scaffolded. `games/*` IS in the root `workspaces` glob, so the folder
auto-joins on creation. Layout (per `games/README.md` + architecture doc §77-84 + research 09
"one canonical home per category"):

```
games/marble_run/
  package.json          # name @fabrikav2/marble_run; deps: three + @fabrikav2/{kernel,ui,sdk};
                        # devDeps: @fabrikav2/testkit, vite, vitest, @playwright/test;
                        # scripts: dev (vite), build (vite build), typecheck, test:unit, e2e
  tsconfig.json         # { extends: "../../configs/tsconfig.base.json", include: ["src"] }
  vite.config.ts        # export default defineConfig(baseViteConfig({ server: { port: 52NN } }))
  playwright.config.ts  # basePlaywrightConfig({ webServer: { command: "npm run dev", port: 52NN } })
  game.config.ts        # AUTHORED HERE (§game.config) — screens/saga/economy/ads/catalog/analytics
  index.html            # #scene canvas + #ui + #saga-ui mount roots
  src/
    main.ts             # bootstrap: canvas → App; import '@fabrikav2/ui/ui.css'; test harness
    shell/              # ⚠ AUDITED — DOM wiring, MUST be literal-free (copy/tokens/assets from design/)
      App.ts            # flow-machine wiring + screen orchestration (replaces v1 App+dom orchestration)
      saga.ts           # buildSagaNodes read-model (ported; unit-tested — the "saga adapter")
    game/               # NOT audited — Three.js gameplay (free canvas)
      BoardScene.ts Stage.ts ModelerSpec.ts   specs/*.json
    puzzle/marble-board/  # NOT audited — copied verbatim from v1 core (board/generate/solver/types/index + test)
    audio/              # NOT audited — AudioBus voice clients (ported Music/Sfx synths)
    core/               # Constants.ts, SaveState.ts (kernel-persist backed)
    levels/levels.generated.ts   # 20 committed levels (verbatim)
  design/               # NOT audited (literals live here legally) — GENERATED layer, git-committed
    tokens.css copy.ts assets.ts
  assets/               # ported binary assets referenced by design/assets.ts
  tests/
    unit/               # game.config + saga adapter (+ mirror board.test / rand pinned)
    e2e/                # authored spec via @fabrikav2/testkit (conductor executes — sandbox note)
```

**Audit-scope decision (the single most important structural call):** the DOM shell lives in
`src/shell/` (audited → literal-free), while the Three.js renderer lives in `src/game/`
(un-audited → keeps its `COLORS3D`/`W3D` numeric constants and canvas-texture hex inline,
which is correct — those are gameplay rendering values, not design-sheet tokens). This
resolves the apparent tension between "port BoardScene verbatim (full of hex)" and "zero hex
literals": BoardScene's hex is gameplay `src/`, never shell.

## Port ledger — take / adapt / import / build-fresh (per module)

### Gameplay (copy into `src/`) — the engine/view split is the port's biggest asset

| v1 source | Verdict | Notes |
|---|---|---|
| `packages/core/src/puzzle/marble-board/{board,generate,solver,types,index}.ts` + `board.test.ts` | **copy-verbatim → `src/puzzle/marble-board/`** | The whole game logic; headless, framework-free, 224-line test. Research 06 verdict quoted: "single-consumer… move it into `games/marble_run` proper rather than pretending it's core." Only external dep is `mulberry32`. |
| `mulberry32` (v1 `core/runtime/rand.ts`) | **import from `@fabrikav2/kernel`** (NOT copy) | Verified byte-identical to v1 and kernel already ships the pinned-sequence test (`rand.test.ts:29` "Marble Run committed level sets depend on this exact sequence", `mulberry32(101)===0.1356478596571833`). Importing satisfies the no-duplication linter AND preserves level identity. `generate.ts`'s one import repoints to `@fabrikav2/kernel`. |
| `levels/levels.generated.ts` (20 levels) | **copy-verbatim → `src/levels/`** | Pure `LevelDef[]` data; depends on the pinned PRNG (safe since mulberry32 is unchanged). Carry the gen script too if future edits wanted. |
| `three/ModelerSpec.ts` + `modeler/specs/*.json` (5) | **copy-verbatim → `src/game/`** | `three`-only, self-contained declarative mesh builder. |
| `three/Stage.ts` (226) | **copy-with-changes → `src/game/`** | Self-contained but `window`-coupled (innerWidth/DPR/resize) and three-version-sensitive (`outputColorSpace`, `SRGBColorSpace`, `PCFSoftShadowMap`, `setViewOffset`). Camera framing may re-fit to v2 viewport; consider `createResponsiveLayout` from kernel for DPR/fit math. |
| `three/BoardScene.ts` (1820) | **copy-with-changes → `src/game/`** | Preserve the contract (`new BoardScene(engine, {onAbsorbed,onBlockedImpact})`, `animateChange`, `tick(dt)`, `boardSize()`, `breakCompletedColor(color)`, callbacks fire on animation completion). Three r150+ APIs (`MeshPhysicalMaterial.clearcoat`) + DOM coupling: canvas-2D procedural textures and a `document.body` `mistake-feedback` CSS-shake class (S6). |
| `core/Constants.ts` (51) | **copy-verbatim → `src/core/`** | Gameplay tuning + `COLORS3D`/`W3D`. Feeds the design/ extraction but stays in `src/` (renderer reads it). `LEVEL_COUNT=20, LEVEL_COIN_REWARD=25, HINT_COIN_COST=125, LONG_PRESS_ROUTE_MS=1200, SAVE_KEY='marble_run_v5_save'`. |
| `core/SaveState.ts` (112) | **copy-with-changes → `src/core/`** | Swap v1 core's persisted-json helpers for **kernel's `loadPersistedJson`/`savePersistedJson`** (identical semantics, already landed). Preserve `SAVE_KEY` + the `v:2` schema `{v,unlocked,coins,sfx,music,haptics}` so any existing save migrates. |
| `engine/*.ts` shims | **become local barrels** | Repoint the five re-export files from `@fabrika/core/*` to the local `src/puzzle/marble-board` (and `mulberry32` → `@fabrikav2/kernel`). Full symbol list captured in research. |

### Shell surfaces → v2 screens (build in `src/shell/`, drive from `game.config` + `design/`)

| v1 surface (`App.ts`/`dom.ts`) | v2 replacement | Wiring |
|---|---|---|
| Menu bar + banner + Play (`dom.ts:145`) | `mountHomeMenu` | header/actions injected copy+assets; composes SagaMap |
| Saga rail (`dom.ts:170` + `shell/saga.ts` + `shellTheme.ts`) | `mountSagaMap` | `state.nodes` = `buildSagaNodes(unlocked, MENU_SAGA_WINDOW)`; `onSelectLevel(id) → gate → machine.start(String(id))`; `--fab-levelmap-*` theme from `design/tokens.css` |
| Settings modal (`dom.ts:555` + `shell/settings.ts`) | `mountSettingsPage` | `settings` = `{music,sfx,haptics, labels}` (labels from copy.ts); `onToggle(key,next)` persists via SaveState + drives AudioBus mute / haptics gate; opened via `pageStack.push` |
| Win / Fail / Finale (`dom.ts:461/500/539`) | `mountResultCard` (`variant:'win'|'lose'`) | **only two variants exist (S3)** — finale is a win-variant with finale copy + single Menu action; win reward-display slot uses `animateEconomyTransfer` |
| Pause (was in-game Settings modal) | `mountPauseOverlay` | new dedicated overlay; actions resume/settings/quit |
| Route-blocked / streak / save-unavailable toasts (`dom.ts:244/234/522`) | `mountToaster` (ToastSystem) | `show(message)`; messages from copy.ts |
| Coin-fly (`dom.ts:404/676`, 760ms/84px) | `animateEconomyTransfer` + `resolveDomAnchorToCanvasPoint` | the stripped-FTD copy dies; cross-substrate Three.js-sprite → DOM-counter bridge from wave-B (S12) |
| Connectivity (new) | `mountConnectivityIndicator` (optional) | online/offline copy from copy.ts; part of the aesthetics-gate surface list |
| Debug panel (four-finger, `dom.ts:259`) | `mountDebugPanel` + `createTuningStore` from `@fabrikav2/testkit/debug` (or drop) | dev-only; recommend minimal-or-drop, not core scope (S10) |
| Screen enum + lifecycle (`App.ts`) | `@fabrikav2/kernel/flow` machine | see §central integration |

### `shell/saga.ts` — the "saga adapter" (AC-named, unit-tested)

**copy-verbatim → `src/shell/saga.ts`** (pure, no DOM/SaveState/Three — audit-safe). API:
`buildSagaNodes(unlocked, options?) → LevelMapNode[]`, `MENU_SAGA_WINDOW = { ahead: 4, behind: 0 }`.
Behavior: exactly one `current` (`clamp(unlocked,1,20)`), below=`completed`, above=`locked`,
window ordered descending (forward-fade geometry `mountSagaMap` expects), edge-clamped with
shortfall redistribution to keep window size stable. Node shape
`{ id:number, label:String(n), name:\`Level ${n}\`, state }`. Port its `saga.test.ts` slice as
the AC's "saga adapter" unit test. **Note:** `mountSagaMap` fires `onSelectLevel` for *every*
node incl. locked — gating (only `current` is playable) stays in the shell handler, matching
v1's `onSelectLevel` guard.

## Contract #1 to AUTHOR HERE — `game.config.ts`

**No `GameConfig` type, no `defineGame`, no kernel schema exists** (S9). The architecture doc
specifies only the *field list* in prose: "declares screens used, saga shape, economy, ad
placements, product catalog, analytics events — the shell consumes this, the game never
touches shell internals." So this card defines the type locally (co-located; the future
generic ingester of the architecture doc's round-trip reads it — that's a *later* card, not
this one). Recommended minimal-but-honest shape, keyed to what marble actually uses:

```ts
export interface GameConfig {
  id: 'marble_run';
  screens: {                     // which @fabrikav2/ui screens the shell mounts + their static config
    home: true; saga: true; settings: true; result: true; pause: true; toast: true;
  };
  saga: {                        // saga read-model shape (the shell calls buildSagaNodes)
    levelCount: number;          // 20
    window: { ahead: number; behind: number };   // { ahead: 4, behind: 0 }
  };
  economy: {                     // marble = presentational coin-fly ONLY, no wallet/ledger (research 04 claim 8)
    coinRewardPerLevel: number;  // 25
    hintCost: number;            // 125
  };
  ads: { rewardedForSaveRun: boolean };            // marble's only placement (fail-save)
  catalog: never[];              // marble ships no IAP products in the pilot
  analyticsEvents: readonly string[];              // level:start/complete/fail canonical + any game events
}
```

**Simplicity note (operating contract #2):** do NOT over-model this to the full architecture
field list where marble has no need (no product catalog, minimal economy). Keep it a plain
typed literal; the AC only asks for *unit tests for `game.config`* (validate the literal
against the type / invariants like `levelCount === LEVELS.length`, window sizes ≥ 0). Flag on
the card that the *canonical* `GameConfig` type may be extracted to a shared package by a
later game — for the pilot it lives in the game.

## Contract #2 to AUTHOR HERE — the `design/` layer

The `design/` files are "generated, git-committed, never hand-edited — output of the
design-sheets round-trip." **But the ingester round-trip is a later card** (the card body
says: "hand-author initial content extracted from `style.css`/`Constants.ts` values … the
ingester round-trip replaces hand-editing in a later design-sheets card"). So this card
**hand-authors the initial `design/`** in the format the round-trip will later produce,
governed by the design-sheets `sourceMap.kind → file` mapping (research 05):

- **`design/tokens.css`** — a CSS file of `--fab-*` custom-property declarations
  (`sourceMap.kind: 'css-var'`). This is the ONE sanctioned home for literal color/size
  values (the audit's CSS carve-out permits hex only as the direct single-line value of a
  `--fab-*` prop). Seed set = the reconciled marble palette: `--sugar-marble-*` (6 candy
  colors = `COLORS3D.marble`), wood tones, bg gradient, text inks, panel borders, radii
  (`pill 999px`, `panel 34px`, `card 24px`), gaps, plus the full `--fab-levelmap-*` group
  from `shellTheme.ts` (node sizes, art urls, line/glow). **Reconcile the tri-source
  divergence (S11):** v1 defines the palette three times (`COLORS3D`, `MARBLE_LEVELMAP_THEME`,
  raw CSS) and they disagree (`bg-top` is `#9b7bcd` in CSS vs `#9b7bc7` in Constants) — pick
  the `:root` CSS values as canonical, note the pick. The large inline-hex surface in
  `style.css` (every gradient/shadow) must be swept into named tokens.
- **`design/copy.ts`** — TS module exporting UI copy strings (`sourceMap.kind: 'ts-string'`,
  natural-language copy — the "copy schema" the architecture doc says design-sheets must
  gain; today it's hand-authored). Seed = the full copy inventory: `"Marble Run"`, Play
  `\`Level ${n}\``, `"HINT"`, win `"Next"/"Finish"/"Reward"`, fail `"No hearts left!"/"Watch an
  ad to continue."/"Watch Ad"/"Retry"`, finale `"All marbles sorted!"/"More levels are on the
  way!"/"Awesome"`, settings `"Music"/"Sound Effects"/"Haptics"/"Restart"/"Home"/"Close"/"Reset
  Progress"`, streak phrases, `"route blocked"`, `"Rewarded ad unavailable…"`, etc.
- **`design/assets.ts`** — TS module exporting asset URL imports (`sourceMap.kind:
  'ts-const'`/`assetBindings`). Seed = the ported binaries: fonts (Fredoka/Lilita/Titan),
  level-node webps, banner, ribbons, coin/gear/replay icons, the `vida/` button/ribbon set.
  Copy them into `games/marble_run/assets/`.

The shell (`src/shell/**`) imports copy from `design/copy.ts`, assets from `design/assets.ts`,
and applies tokens via `applyTheme(root, tokens)` / a `--fab-*` `ThemeTokens` object built
from `tokens.css` — never a literal in shell code. This is exactly what makes `npm run audit`
pass.

## Contract #3 — audio port onto the SDK AudioBus

Marble's audio is **390 lines of procedural Web-Audio synthesis, zero asset files**
(`Music.ts` 145 + `Sfx.ts` 245). The SDK ships the bus but **no synth content** (only a
`testSynth`). Port each sound as an AudioBus client in `src/audio/` (un-audited gameplay code):

- `const bus = createAudioBus()`. Register each v1 one-shot as a **voice** source:
  `bus.register('winFanfare', { kind: 'voice', render(ctx, out) { /* ported oscillator/noise graph */ return { stop() {…} } } })`.
  Sounds: `uiTap, toggleClick, spawnTick, rollTic, absorbPlop, thud, heartBreak, winFanfare,
  loseSting`, and the music-box loop + drone.
- **Channels:** `music` + `sfx` (the bus's two channels match v1 exactly). SFX play on `sfx`,
  music-box loop on `music`.
- **Fades:** v1's 2.2s fade-in / 0.8s fade-out → `bus.setVolume('music', v, ms)`.
- **Rolling loop:** v1 `setRollingActive(active)` → `bus.play('roll', { channel:'sfx', loop:true })`
  / `bus.stop(handle)`.
- **Mute:** `bus.setMuted('music'|'sfx', !enabled)` driven from SaveState toggles (persistence
  is the game's concern, not the bus's).
- **Unlock:** `bus.unlock()` on first gesture (replaces v1 `unlockAudio()`).
- **Haptics:** `createHaptics({ isEnabled: () => saveState.hapticsEnabled })` → `impact/notification`;
  multi-beat sequences (win = medium+success) stay at the call site.

## Test / verification plan

happy-dom for shell unit tests; never assert real computed styles (the wave-A `@layer` caveat).

| Suite | Asserts |
|---|---|
| `tests/unit/game-config.test.ts` | the `game.config.ts` literal satisfies the type + invariants (`saga.levelCount === LEVELS.length`, window fields ≥ 0, economy positive, `id==='marble_run'`) — **AC leg** |
| `tests/unit/saga.test.ts` | port of v1 `saga.test.ts`: exactly-one-current, completed-below/locked-above, descending order, edge clamping (no id outside `[1,20]`), stable window size at all positions — **AC leg (saga adapter)** |
| `src/puzzle/marble-board/board.test.ts` | copied verbatim — roll/block/preview/streak/stars/plugs/solver/generator determinism |
| `tests/unit/rand-pinned.test.ts` (optional) | re-assert `mulberry32(101) → 0.1356478596571833…` locally so a kernel bump can't silently invalidate committed levels |
| `tests/e2e/play.spec.ts` | authored with `@fabrikav2/testkit/playwright`: `gotoAndWaitForHarness` → menu, `clickCanvasFraction`/harness `startLevel`+`tapCell` to drive a level, assert win/fail screen. **Sandbox can't run Playwright — author + note in handoff; conductor executes** |

Gates: `npm run typecheck && npm run test:unit && npm run build --workspace=games/marble_run && npm run audit`.
**S4 caveat:** the game must ADD `dev`/`build` scripts + `vite.config.ts` (no root `dev`/`build`
and no existing `dev` script anywhere to copy) — the AC verification commands only work after
this scaffolding lands.

## Acceptance criteria (restated) & how they'll be verified

- [ ] `npm run dev --workspace=games/marble_run` serves a playable menu→level→win/fail loop
      with v2 screens (needs the authored `dev` script + `vite.config.ts`).
- [ ] `zero hex/copy literals outside design/` → `npm run audit` green. Interpretation: the
      *no-literals* linter scans `games/*/src/shell/**` (+ `packages/ui`), NOT gameplay
      `src/game`/`Constants.ts`/`design/`. Shell must be literal-free via `design/`.
- [ ] `npm run build --workspace=games/marble_run` (vite build) green.
- [ ] `npm run typecheck --workspace=games/marble_run` green (strict base; `three` typed).
- [ ] `npm run test:unit --workspace=games/marble_run` green incl. **game.config + saga adapter** suites.
- [ ] e2e spec authored against `@fabrikav2/testkit` (execution deferred to conductor).

## Surprises / open items to carry forward to `worked`

- **S1 — FlowMachine surface ≠ the card's assumption.** No `subscribe`/generic `transition()`;
  use `machine.events.on(...)` + typed methods + `can()`. Marble MUST construct with
  `createFlowMachine({ optionalStates: ['levelSelect','paused'] })` or LevelSelect/Paused throw.
  Level ids are strings in the machine but numbers in the engine/levels — centralize the
  `String(n)`/`Number(id)` coercion at the shell boundary.
- **S2 — `mulberry32` is imported from `@fabrikav2/kernel`, not copied** (byte-identical +
  no-duplication linter forbids re-declaring it). The marble-board module is copied (its
  symbols aren't in any package). Verified the kernel PRNG reproduces the pinned sequence, so
  the 20 committed levels stay valid.
- **S3 — `mountResultCard` has only `'win'|'lose'` variants; v1 had win/fail/FINALE (3).**
  Model finale as a `variant:'win'` ResultCard with finale copy + a single Menu action, shown
  when `next()` would exceed `LEVEL_COUNT` (then `toMenu()`). No dedicated finale surface/state.
- **S4 — no scaffolding exists.** `tools/create-game` is a stub, no `games/_template`, no root
  `dev`/`build`, no `dev` script anywhere to copy. Hand-create the workspace (`package.json`,
  `tsconfig.json` extending `../../configs/tsconfig.base.json`, `vite.config.ts` via
  `baseViteConfig`, `playwright.config.ts` via `basePlaywrightConfig`). Pick an unused vite port.
- **S5 — SaveState uses kernel persist**, not v1 core's helpers (identical semantics, landed).
  Preserve `SAVE_KEY='marble_run_v5_save'` + `v:2` schema for save migration.
- **S6 — BoardScene DOM coupling.** It writes a `document.body` `mistake-feedback` CSS class
  (the screen-shake) whose rule lived in v1 `style.css`; and builds canvas-2D procedural
  textures. Keep the shake rule as a **gameplay concern in `src/game`** (un-audited), not a
  design token. Re-provide the canvas texture hooks.
- **S7 — `three` is r150+ version-sensitive** (`MeshPhysicalMaterial.clearcoat`,
  `SRGBColorSpace`, `outputColorSpace`, `setViewOffset`, `PCFSoftShadowMap`). Add `three` as a
  **declared dependency** (deps-declared linter) and pin a version that keeps these APIs.
- **S8 — audio content is the game's, not the SDK's.** Port ~390 lines of oscillator/noise
  synth as `{kind:'voice'}` AudioBus clients in `src/audio`; the SDK only supplies the bus.
- **S9 — `game.config.ts` type is authored here** (no kernel schema). Keep it minimal to
  marble's real needs (no catalog, minimal economy); flag that a canonical shared `GameConfig`
  may be extracted by a later game.
- **S10 — debug panel** (four-finger v1 dev tool) → `@fabrikav2/testkit/debug`
  (`mountDebugPanel`+`createTuningStore`) exists, or drop. Recommend out-of-core-scope for the
  pilot to avoid balloon.
- **S11 — design tokens are tri-sourced and unreconciled in v1** (`COLORS3D` vs
  `MARBLE_LEVELMAP_THEME` vs raw CSS; `bg-top` disagrees `#9b7bcd`/`#9b7bc7`). Reconcile into
  one `tokens.css`; pick the `:root` CSS values as canonical and note it. The inline-hex sweep
  of `style.css` is a non-trivial extraction job for the design layer.
- **S12 — cross-substrate coin-fly** (Three.js sprite → DOM HUD counter) needs the wave-B
  `resolveDomAnchorToCanvasPoint` bridge + `animateEconomyTransfer`; the v1 bespoke
  `animateCoinToken` copy is dropped.
- **AESTHETICS GATE (obligation transferred in — conductor comment 1).** This card carries a
  HARD aesthetics gate: a visual review of ALL v2 ui surfaces themed in this game
  (HomeMenu/SagaMap, SettingsPage, ResultCard win+lose, PauseOverlay, PageShell slide-up,
  Toast, coin-fly EconomyTransfer, ConnectivityIndicator) with screenshots captured into
  `evidence/<date>-v2-screens/`. Do NOT self-skip aesthetics on this card. This obligation is
  discharged at the `aesthetics_reviewed` stage by that worker — carried here so it is not lost.
