---
title: "packages/ui screens — HomeMenu+SagaMap, SettingsPage, ResultCard, PauseOverlay, slide-up PageShell requirements"
date: 2026-07-06
trello: https://trello.com/c/f156Nyz1
card: f156Nyz1
depends_on: VD1JPfyY
stage: todo → brainstormed
status: requirements-locked
source_readonly: /Users/base/dev/appletolye/fabrika
---

# packages/ui screens — requirements & approach

Requirements/approach artifact for the `todo → brainstormed` transition. This card
lifts the **screen layer** of `@fabrikav2/ui` on top of the wave-A primitives
(`Button`, `ModalShell`, `ToggleRow`, `createUiRoot`) and wave-B `EconomyTransfer`.
Unlike the primitive waves, one of these deliverables is a **contract validation, not
just a port**: every lifecycle screen must implement the `@fabrikav2/kernel/flow`
machine (`@experimental`), and the card names this "the graduation test" — the flow
machine was carried from a v1 module with **zero consumers** and is explicitly
labelled *"WILL be rewritten against the real UI consumers in the ui cards"*
(`machine.ts:13-17`). This doc front-loads that validation because it is the one place
the card authorizes touching `packages/kernel`.

It provides: (1) a per-screen prior-art ledger (take / reject / generalize) against the
read-only v1 tree and the already-landed v2 primitives, (2) the flow-machine graduation
verdict — what fits, what fights, and the recommended resolution of the "back-stack"
requirement, (3) the typed API surface each screen exports, (4) the token inventory
that keeps the source literal-free, and (5) the test plan proving mount/unmount-via-flow
and back-stack behavior. No code is written at this stage.

## Goal

Stand up the five screen surfaces the card enumerates as framework-agnostic,
token-themed DOM components that bind to the kernel flow machine (where they are
lifecycle states) or to a page/back-stack navigator (where they are overlays):

- **HomeMenu + SagaMap** — the `Menu` / `LevelSelect` surface. SagaMap is a
  near-verbatim port of core's `mountLevelMap` — the only proven ≥2-game shared UI
  component in v1 (research 06 §2 "genuine positive"; consumed by FTD `HomeScene` and
  marble `saga.ts`/`App.ts`).
- **PageShell** — a generic full-screen slide-up page primitive (swipe-down-dismiss +
  staggered entrance), generalized from FTD's `openPage`/`closePage`.
- **SettingsPage** — composes PageShell + wave-A `mountToggleRows` + a legal-links slot
  + a privacy-choices slot.
- **ResultCard** — ONE modal shell with win/lose content slots + reward-display slot +
  continue-offer slot, over the wave-A `mountModalShell`.
- **PauseOverlay** — minimal (resume / settings / quit slots), over `mountModalShell`.

AC: each lifecycle screen mounts/unmounts via the flow machine in tests; token-only
styling; back-stack behavior tested. Verification:
`npm run typecheck --workspace=packages/ui && npm run test:unit --workspace=packages/ui
&& npm run test:unit --workspace=packages/kernel`.

## Constraints (inherited, non-negotiable)

- **v1 is READ-ONLY.** Seed from `/Users/base/dev/appletolye/fabrika`; never edit it.
- **DOM-only, token-themed.** No Phaser, no canvas. Theming is `--fab-*` custom
  properties scoped to `.fab-ui`; copy + asset URLs are **injected**, never literal
  (guardrail #2 — the `tools/audit` linter enforces).
- **Files touched: `packages/ui/**`**, and `packages/kernel/src/flow/**` **only if** the
  graduation test forces a contract change (see §Flow verdict — the recommendation is
  that it does not).
- Advance exactly one column; no PRs (conductor merges); no secrets.
- `depends_on: VD1JPfyY` (ui wave A primitives) is **satisfied** — landed on `main`
  (sitrep shows "packages/ui wave A: primitives … merged"). `mountButton`,
  `mountModalShell`, `mountToggleRows`/`buildSettingsModel`, `applyTheme`,
  `UiHandle`/`createUiRoot`, and (from wave B) `animateEconomyTransfer` are all
  importable from `@fabrikav2/ui`.

## The flow-machine graduation test (the central deliverable)

The landed machine (`packages/kernel/src/flow/machine.ts`, `events.ts`) models the
**game lifecycle**, not renderer screens: states `Boot | Menu | LevelSelect | Playing |
Paused | Complete | Failed`; transitions `start | complete | fail | next | retry |
selectLevel | pause | resume | toMenu`; events `level:start | level:complete |
level:fail | level:next | menu:enter`. It is a strict table-driven machine with a
typed emitter, `can(t)` guard, queued listener-requested transitions, and `dispose()`.

### What FITS (validated — no contract change needed)

Four of the five screens map cleanly onto existing states; each binds by subscribing to
the machine and mounting on state-enter / unmounting on state-leave:

| Screen | Flow state | Enter via | Screen actions → transitions |
|---|---|---|---|
| **HomeMenu** | `Menu` | `toMenu()` / boot `toMenu()` | "Levels" → `selectLevel()`; direct "Play" → `start(levelId)` |
| **SagaMap** | `LevelSelect` | `selectLevel()` (Menu→LevelSelect) | node tap → `start(levelId)`; back → `toMenu()` |
| **ResultCard (win)** | `Complete` | `complete()` (Playing→Complete) | Next → `next(nextLevelId)`; Replay → `retry()`; Menu → `toMenu()` |
| **ResultCard (lose)** | `Failed` | `fail()` (Playing→Failed) | Retry → `retry()`; Continue(offer) → stays `Failed` until granted; Menu → `toMenu()` |
| **PauseOverlay** | `Paused` | `pause()` (Playing→Paused) | Resume → `resume()`; Quit → `toMenu()`; Settings → push SettingsPage (NOT a transition) |

Confirmed against both real consumers: v1 `mountLevelMap.onSelectLevel(id)` is exactly
the `LevelSelect → start(id)` edge (FTD `startLevelFromMap`, marble `startLevel`);
marble's `SettingsActionKey` union (`resume|close|restart|home|resetProgress`) is the
Paused-state callback→transition map; marble's `showWin`(Next/Finish) / `showFail`
(Retry / Watch-Ad-continue) are the `Complete.next/retry` and `Failed.retry` edges.

**Verdict: the state/transition model survives contact. No change to the transition
table is required for the lifecycle screens.** This retires the `@experimental` doubt
for the game-lifecycle half of the machine — the graduation the card asks for.

### What FIGHTS (the real finding — the "back-stack" requirement)

Two screens are **not lifecycle states**: **SettingsPage** and the generic **PageShell**.
Settings can open over `Menu`, over `Paused`, or (per v1) as the in-game pause surface
itself. The flow machine has **no page/overlay concept and no back-stack** — its only
"go back" edge is `toMenu()`, a hard jump to `Menu`, not a push/pop. Yet:

- the **AC explicitly requires** "back-stack behavior tested"; and
- `docs/architecture/v2-architecture.md:40` describes the flow machine as *"the
  open/close/**back-stack** contract that `ui` screens implement."*

So the architecture doc's wording says back-stack lives in the flow machine, but the
**landed** machine (inherited from the dead v1 `shell/flow-machine.ts`) has none. This
is the contract fight the card predicted. Wave A already flagged the same gap (wave-A
doc **S1**: a modal/page back-stack "is a follow-up card once a real consumer exists").
**SettingsPage-over-anything and PauseOverlay-opens-Settings are that real consumer now.**

### Recommended resolution (graduation verdict)

**Do NOT push page navigation into the lifecycle machine. Build the back-stack as a
small `ui`-level `PageStack` primitive, orthogonal to `@fabrikav2/kernel/flow`.**

Rationale:
- The lifecycle machine's transition table is level-centric and strict; injecting
  `openSettings`/`closeSettings`/generic-page states would muddy every state (Settings
  reachable from Menu *and* Paused ⇒ combinatorial edges) and break the clean
  "one state = one lifecycle phase" property that made the fit above work.
- A page stack is a genuinely different data structure: an ordered stack of live
  `UiHandle`s with `push(page)` / `pop()` / `back()` (dismiss-top-first, backdrop/scrim
  chaining, hardware/gesture back → pop). That is a `ui` concern (it owns the DOM
  handles), not a kernel concern.
- This keeps `packages/kernel` **untouched** → `npm run test:unit
  --workspace=packages/kernel` stays green trivially, satisfying that AC leg without
  risk.

**Divergence to confirm (SURPRISE S1):** this contradicts the *wording* of
`v2-architecture.md:40` (back-stack "in the flow machine"). Recommendation: treat the
architecture line as aspirational shorthand and implement back-stack in `ui`; note the
divergence on the card so the `worked` worker (or Batu) can ratify. If instead the
decision is to honor the doc literally, the machine change is additive (a parallel
`pageStack: string[]` + `pushPage/popPage` transitions that don't touch the lifecycle
table) and `machine.test.ts` must be extended — but this doc recommends against it.

**Minor contract notes (no change, just callouts for `worked`):**
- **S2 — `next()` needs `nextLevelId`.** `Complete.next` requires the id up front
  (`machine.ts:305`, `requireLevelId`). ResultCard's "Next" button must be handed the
  next level id as **injected data** (consumer computes it from saga config); the screen
  does not derive it. `ENDLESS_LEVEL_ID = 'endless'` exists for endless modes.
- **S3 — `selectLevel()` takes no argument.** It is only the `Menu→LevelSelect` edge
  ("open the map"); the actual pick is `start(levelId)` from `LevelSelect`. So HomeMenu's
  "Levels" button ⇒ `selectLevel()`, and SagaMap's node tap ⇒ `start(id)` — two distinct
  edges, not one.
- **S4 — double-fire guard.** ResultCard/PauseOverlay buttons should guard with
  `if (machine.can(t))` before firing (a double `complete()` in one frame throws
  `FlowMachineError`); `can()` is provided for exactly this.

## Prior-art ledger — take / reject / generalize per screen

### SagaMap → `src/SagaMap.ts` — PORT core `mountLevelMap` NEAR-VERBATIM
Source: v1 `packages/core/src/ui/index.ts:123-229` (`LevelMapNode`/`LevelMapState`/
`LevelMapActions`/`LevelMapOptions`, `buildRail`, `mountLevelMap`).
- Already framework-agnostic and self-described "Pure DOM — no game-state / env
  coupling." Renders a vertical zig-zag rail of `.fab-levelmap-node` buttons (states
  `current | locked | completed`), depth-fade ahead of current (`DEPTH_FAR=3`,
  `DEPTH_DISTANT=4`), an empty-state loading placeholder, and a single delegated click
  listener that fires `onSelectLevel(node.id)` for **every** node (gating is the
  consumer's job — the primitive never blocks a locked tap). Re-entrant by `id`.
- **Windowing stays out** (`buildSagaNodes`/`buildLevelMapNodes`/`MENU_SAGA_WINDOW`)
  — that is game read-model logic; the primitive draws exactly the nodes it is handed.
- **Locked-node rejection UX stays out** (shake classes, `hapticWrong`,
  `onLockedLevelReject`) — game-specific; the consumer wires it on the returned root.
- **Reject the one literal:** `aria-label="Loading levels"` (`index.ts:172`) is the sole
  baked copy string → make it an injected option (`loadingLabel: string`), else the
  audit-linter flags it.
- Flow binding: `onSelectLevel(id)` → consumer coerces + gates + `machine.start(id)`.

### HomeMenu → `src/HomeMenu.ts` — THIN Menu container (composition, minimal new code)
- The card title pairs "HomeMenu+SagaMap"; in **both** v1 consumers the menu surface
  *is* the level map (FTD `HomeScene` mounts `mountLevelMap` into `#home-map-mount`;
  marble `App.showMenu` mounts it into the menu). There is no separate rich "home menu"
  component to port. **Ambiguity resolved (SURPRISE S5):** HomeMenu is a thin `Menu`-state
  container that composes SagaMap as its primary content plus an injected header/title
  slot and optional top-level actions (settings entry, direct-play). It owns the
  `Menu ↔ LevelSelect` binding; it does not reimplement the map.
- Keep it minimal — a container + slots, not a god-component (anti-v1 rule).

### PageShell → `src/PageShell.ts` — GENERALIZE FTD `openPage`/`closePage`
Source: v1 FTD `games/find_the_dog/src/ui/HUD.ts:494-595`.
- **Take the mechanics:** full-screen overlay that slides up on a `--open` class added
  in `requestAnimationFrame` (CSS transform+opacity transition), CSS-driven staggered
  child entrance, swipe-down-to-dismiss (`touchstart` records `clientY`; `touchend`
  dismisses when downward delta ≥ threshold; a gesture starting inside a scrollable body
  is ignored so scroll still works), and cleanup deferred to the `transitionend` of the
  **transform** (not the faster opacity fade) with a `setTimeout` fallback.
- **Reject the coupling:** hard-coded titles `'Shop'`/`'Settings'`, the back-button asset
  `/ui/page-header/back_button.png`, element IDs (`home-page-overlay`, `home-shell`,
  `hud-overlay`), the `innerHTML` template, the direct calls into FTD renderers, the
  `playUITap()` singleton, and inline magic numbers.
- **Generalize:** `mountPageShell({ mountInto, header?, body, onDismiss?, backIcon?,
  swipeDownDismiss?, instant?, theme, id }) → UiHandle` (built on `createUiRoot`, so it
  inherits idempotent dismiss + tracked timers + abort signal). Header copy + back-icon
  URL are injected. The 80px swipe threshold and 340/420ms timings become
  `--fab-page-*` tokens with JS numeric fallbacks (happy-dom computes no `@layer`
  defaults — the wave-A **S4** pattern applies: read via `getComputedStyle` with a JS
  fallback, never rely on real computed styles in tests).
- PageShell is the substrate SettingsPage (and the later Shop card) build on, and the
  unit that a `PageStack` pushes/pops.

### SettingsPage → `src/SettingsPage.ts` — COMPOSE (PageShell + wave-A ToggleRow + slots)
Sources: FTD `HUD.ts:844-963` (`renderSettingsRows` + `wireSettingsPageListeners`);
marble `sugar3d/src/shell/settings.ts` (the pure `buildSettingsModel` view-model).
- Wave A **already ported** `buildSettingsModel`/`SettingsViewModel` (toggles-only,
  labels injected) and `mountToggleRows`. SettingsPage **reuses** them — do not
  re-extract. It renders: PageShell(title slot) → `mountToggleRows(buildSettingsModel(…))`
  → a **legal-links slot** → a **privacy-choices slot**.
- **Legal-links slot:** injected `{ label, url }[]` (privacy-policy / terms / support in
  v1) rendered as buttons/links; the URLs and labels are **injected copy**, and the
  open-link action is an injected callback (`onOpenLink(url)`), never a hard-coded href.
- **Privacy-choices slot:** an injected optional action `{ label, onInvoke }` with
  in-place pending/disabled state (v1 `privacyConsentService.showPrivacyOptions()` +
  "Opening…" + toast) — the SDK call is injected, not imported. Optional (omit → no row).
- **Reject** all FTD literals/singletons: copy ("Music"/"Privacy"/"Terms"/"Support"),
  `/ui/settings/*` asset paths, `#toggle-*` IDs, `gameState.settings`/`save()` binding,
  `analytics`/`privacyConsentService`/`setMusicEnabled` singletons, the `innerHTML`
  template. Toggle side-effects (persist, audio, analytics) are the consumer's
  `onToggle(key,next)` handler.
- **Marble's richer action rows** (`resume|close|restart|home|resetProgress`) are the
  **PauseOverlay's** concern, not SettingsPage's (SettingsPage is the out-of-game page).
  Keep SettingsPage to toggles + legal + privacy; PauseOverlay owns the in-game actions.

### ResultCard → `src/ResultCard.ts` — ONE shell, win/lose slots, over wave-A `mountModalShell`
Sources: FTD `LevelCompleteOverlay.ts` (thin wrapper over core `mountLevelComplete`,
`index.ts`); marble `dom.ts:461-553` (`showWin`/`showFail`/`showFinale`). Research 04
claim 7: **4 games, 4 divergent win/lose surfaces** — the dedup target.
- **Build ONE `mountResultCard({ variant: 'win' | 'lose', … })` on `mountModalShell`**
  (wave A already gives the backdrop/card/actions/dismiss/ARIA shell). The card asks for
  win/lose **content slots** + a **reward-display slot** + a **continue-offer slot**:
  - `title`/`messages` slot — injected copy (win headline, lose "no hearts" message);
  - `rewardDisplay?` slot — for win, the coin reward. **Reuse wave-B
    `animateEconomyTransfer`** for the coin-fly rather than re-porting core
    `mountLevelComplete`'s bespoke counter (that heavy win surface — rotating messages,
    claim-×2 rewarded-ad state machine, confetti — is a proven but *game-monetization*
    concern; keep it OUT of the generic shell). The reward-display is a slot the
    consumer fills; a coin-fly helper is available, not baked in.
  - `continueOffer?` slot — for lose, the "watch ad to continue" affordance. **The offer
    content itself comes from the sdk/iap card** (per the card body); ResultCard only
    provides the slot + the button that invokes an injected `onContinue()`.
  - actions: win → Next(`next`)/Replay(`retry`)/Menu(`toMenu`); lose →
    Retry(`retry`)/Continue(offer)/Menu(`toMenu`) — as `ModalAction[]`.
- **Reject:** all `vida-*` asset imports, hard-coded copy ("No hearts left!", "Watch Ad",
  "All marbles sorted!", "Finish"), `innerHTML` templates, `data-a`/`data-r` selectors,
  `gameState`/`scaffoldEvents`/`analytics` bindings, the `activeLevelCompleteHandle`
  singleton, `import.meta.env` E2E gates.
- **SURPRISE S6 — scope boundary on the reward surface.** Core `mountLevelComplete` is a
  large, genuinely-good win surface (claim-×2, message rotation, confetti). The card
  says "reward-display + continue-offer **slots** (offers themselves come from sdk/iap
  card)" — i.e. ResultCard is a **shell with slots**, not a re-home of the whole win
  surface. Recommendation: port the *shell + slot contract* now; leave the rich
  claim-×2/confetti win-reward component (and its `--fab-complete-*` tokens) as a
  **later dedicated card** that fills the reward-display slot. Flag so `worked` doesn't
  balloon this into re-porting the 300-line overlay.

### PauseOverlay → `src/PauseOverlay.ts` — MINIMAL, over `mountModalShell`
Source: **no dedicated v1 pause overlay exists** — in v1 the in-game **Settings modal is
the pause surface** (marble HUD pause button → `onPause()` → `showSettings(inGame=true)`;
FTD has none). **SURPRISE S7:** the card asks for a minimal standalone PauseOverlay
(resume/settings/quit slots) that v1 never had — this is a *new* small component, not a
port. Build it fresh on `mountModalShell`:
- `mountPauseOverlay({ mountInto, actions: { onResume, onSettings, onQuit }, labels, theme })`
  → three injected-label actions. Resume → `machine.resume()`; Quit → `machine.toMenu()`;
  Settings → push SettingsPage onto the PageStack (orthogonal to the machine).
- Reference for the callback→transition map: marble's `SettingsActionKey` union. Keep it
  minimal — no reset-progress two-tap dance (that is SettingsPage's out-of-game concern).

## Typed API surface (what `src/index.ts` must additionally export)

```ts
// SagaMap (port of core mountLevelMap)
mountSagaMap(opts: SagaMapOptions): UiHandle
type LevelNodeState = 'current' | 'locked' | 'completed'
type LevelMapNode = { id: string | number; label: string; name: string; state: LevelNodeState }
type SagaMapOptions = { mountInto; state: { nodes: readonly LevelMapNode[] };
                        actions: { onSelectLevel: (id: string | number) => void };
                        loadingLabel: string; theme?; id? }
// HomeMenu (thin Menu container composing SagaMap)
mountHomeMenu(opts: HomeMenuOptions): UiHandle
// PageShell (generic slide-up page)
mountPageShell(opts: PageShellOptions): UiHandle
// SettingsPage (PageShell + ToggleRow + legal/privacy slots)
mountSettingsPage(opts: SettingsPageOptions): UiHandle
// ResultCard (one shell, win/lose)
mountResultCard(opts: ResultCardOptions): UiHandle   // { variant: 'win' | 'lose', … }
// PauseOverlay (minimal, new)
mountPauseOverlay(opts: PauseOverlayOptions): UiHandle
// PageStack (back-stack navigator — the AC's "back-stack")
createPageStack(opts?: PageStackOptions): PageStack  // { push(mountFn): UiHandle; pop(): void;
                                                     //   back(): void; depth: number; top: UiHandle | null }
```

All reuse wave-A `UiHandle`/`createUiRoot`/`applyTheme` and wave-A/B exports
(`mountModalShell`, `mountToggleRows`, `buildSettingsModel`, `animateEconomyTransfer`).

## Token inventory (keeps `src/*.ts` and component CSS rules literal-free)

New `@layer fab.components` rules + `@layer fab.tokens .fab-ui` neutral defaults to add
to `src/ui.css` (the wave-A **S5** exemption: the token-definition layer is the one
sanctioned home for literal default values; the AC grep targets `packages/ui/src/*.ts`):

- **SagaMap** — port the full `--fab-levelmap-*` group + `.fab-levelmap-*` rules from v1
  `ui.css` (geometry: `-path-width/-node-gap/-offset/-node-size/-node-current-size/
  -node-font/-node-current-font`; depth: `-far-opacity/-far-scale/-distant-opacity/
  -distant-scale`; colors: `-node-color/-dot-color/-locked-color/-locked-dot-color/
  -completed-color/-current-color`; line: `-line/-line-glow`; loading:
  `-loading-bg/-loading-border/-loading-shadow/-loading-current-bg`; per-state art:
  `-art-default/-art-locked/-art-completed/-art-current`, all default `none`). Wave A
  deliberately left these behind (wave-A doc §ui.css) for this card.
- **PageShell (NEW):** `--fab-page-{overlay-bg, card-bg, header-height, slide-ms,
  slide-easing, exit-ms, swipe-dismiss-px, stagger-step-ms, back-icon-size}`.
- **SettingsPage (NEW):** `--fab-settings-{section-gap, legal-color, legal-separator,
  legal-gap}` (toggle tokens already exist from wave A: `--fab-toggle-*`).
- **ResultCard (NEW, generic shell only):** `--fab-result-{win-accent, lose-accent,
  reward-color, card-gap}` — the shell chrome. The rich `--fab-complete-*` win-reward
  token group stays with the later reward-display card (S6).
- **PauseOverlay (NEW):** `--fab-pause-{action-gap, title-color}` (mostly inherits modal
  tokens).

## Scaffolding — already in place (no dependency add this card)

Verification command: `npm run typecheck --workspace=packages/ui && npm run test:unit
--workspace=packages/ui && npm run test:unit --workspace=packages/kernel`.

- **DOM test env: DONE.** `packages/ui/vitest.config.ts` already sets
  `environment: 'happy-dom'` and `happy-dom@20.10.6` is a root devDependency (landed in
  wave A). **No dependency add is needed** — this card, unlike wave A, has no
  consent-gated dep step.
- `packages/ui/package.json` already has `typecheck`/`test:unit` scripts + the
  `exports` map (`.` + `./ui.css`); add screen files under `src/` (auto-picked by the
  `src/**/*.test.ts` include). No new `dependencies` — screens are zero-dep DOM.
- `packages/ui/tsconfig.json` extends the strict base already; screens must satisfy
  `verbatimModuleSyntax`, `noUnusedLocals/Parameters`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`. Base `lib` includes `DOM` — `TouchEvent`/`transitionend`
  types are covered.
- **kernel stays green:** the recommended plan does **not** touch
  `packages/kernel/src/flow/**`, so `test:unit --workspace=packages/kernel` passes
  unchanged. Only if the `worked` worker overrides §Flow verdict and edits the machine
  must `machine.test.ts`/`events.test.ts` be extended.

## Test porting / authoring plan

All new suites (no v1 UI tests to port for these screens except the SagaMap render
behavior, which has a v1 `index.test.ts` slice worth mirroring). happy-dom + fake timers;
never assert real computed styles (S4 fallbacks).

| Suite | Asserts |
|---|---|
| `SagaMap.test.ts` | nodes render in order with state classes; empty→loading placeholder + injected `loadingLabel` (no baked copy); delegated click fires `onSelectLevel(id)` for every node incl. locked; re-entrant by id; `dismiss()` unmounts |
| `HomeMenu.test.ts` | composes SagaMap; "Levels" action calls `selectLevel`; **mount on `Menu` enter / unmount on leave** driven by a real `createFlowMachine()` |
| `PageShell.test.ts` | slide-in class added on rAF; swipe-down past threshold → dismiss, below → stays; gesture starting in scrollable body ignored; cleanup on transform `transitionend` + timeout fallback; injected header copy/back-icon |
| `SettingsPage.test.ts` | renders toggle rows from `buildSettingsModel`; injected legal links fire `onOpenLink(url)` (no hrefs); privacy-choices optional + pending state; zero literal copy/asset paths |
| `ResultCard.test.ts` | one shell, `variant:'win'` vs `'lose'` content slots; reward-display + continue-offer slots present when supplied; actions map to `next/retry/toMenu`/`onContinue`; **mount on `Complete`/`Failed` enter, unmount on leave** via flow machine; `can()` guard on double-fire |
| `PauseOverlay.test.ts` | resume/settings/quit actions fire `resume`/push-settings/`toMenu`; **mount on `Paused` enter / unmount on `resume` leave** via flow machine |
| `PageStack.test.ts` | **back-stack behavior (AC):** `push` mounts + increments depth; `pop`/`back` dismisses top-first (LIFO); `back` at depth 0 is a no-op; nested Settings-over-Pause pops back to Pause not Menu; hardware/gesture back → `pop` |

The two AC legs — "each screen mounts/unmounts via flow machine" and "back-stack behavior
tested" — are covered by driving a **real `createFlowMachine()`** in the lifecycle-screen
suites and by `PageStack.test.ts` respectively.

## Acceptance criteria (restated) & how they'll be verified

- [ ] `npm run typecheck --workspace=packages/ui` green.
- [ ] `npm run test:unit --workspace=packages/ui` green (7 new suites).
- [ ] `npm run test:unit --workspace=packages/kernel` green (unchanged under the
      recommended no-kernel-edit plan).
- [ ] Each lifecycle screen (HomeMenu, SagaMap, ResultCard, PauseOverlay) mounts on its
      flow state's enter and unmounts on leave, proven with a real `createFlowMachine()`.
- [ ] Back-stack behavior tested (`PageStack`: push/pop/back LIFO, nested pop, no-op at
      depth 0).
- [ ] Token-only styling: `grep -RniE "#[0-9a-f]{3,8}|rgba?\(" packages/ui/src/*.ts`
      returns nothing; all copy + asset URLs injected; new defaults only in the
      `@layer fab.tokens .fab-ui` block of `ui.css`.

## Surprises / open items to carry forward

- **S1 — "back-stack" belongs in `ui`, not `kernel/flow` (recommendation), which
  diverges from `v2-architecture.md:40`'s wording.** The landed flow machine is a pure
  *game-lifecycle* machine with no page/back-stack; forcing pages into it muddies the
  state table. Recommend a small `ui` `PageStack` primitive and leaving `kernel/flow`
  untouched (keeps kernel tests green). Confirm the divergence on the card; if the doc is
  to be honored literally, the machine change is additive and `machine.test.ts` must grow.
- **S2 — `next()` requires `nextLevelId` up front** (`machine.ts:305`). ResultCard's
  "Next" must be handed the id as injected data; it does not compute it.
- **S3 — `selectLevel()` is argument-less** (Menu→LevelSelect only); the level pick is a
  separate `start(id)` edge from LevelSelect. HomeMenu and SagaMap own different edges.
- **S4 — happy-dom computes no `@layer` token defaults** → any screen reading a token via
  `getComputedStyle` (PageShell swipe/timing) needs a JS numeric fallback; tests use fake
  timers + fallbacks, never real computed styles (wave-A proven pattern).
- **S5 — HomeMenu is a thin container, not a rich component.** In both v1 consumers the
  menu surface *is* the level map; HomeMenu composes SagaMap + injected header/actions and
  owns only the `Menu↔LevelSelect` binding. Avoid rebuilding a god-menu.
- **S6 — ResultCard is a shell with slots, not a re-home of core `mountLevelComplete`.**
  The rich claim-×2/confetti/message-rotation win surface (+`--fab-complete-*` tokens)
  stays for a later reward-display card; this card ships the shell + reward-display +
  continue-offer *slot contract*, reusing wave-B `animateEconomyTransfer` for coin-fly.
  Prevents scope balloon.
- **S7 — PauseOverlay is NEW, not a port.** v1 had no dedicated pause overlay (the
  in-game Settings modal doubled as pause). The card asks for a minimal standalone
  resume/settings/quit overlay — build fresh on `mountModalShell`.
- **S8 — the graduation retires `@experimental` for the lifecycle half only.** The
  state/transition model is validated by these four real consumers; the events map
  (`level:start/complete/fail/next`, `menu:enter`) is sufficient. If the `worked` worker
  confirms no kernel edit, the machine's `@experimental` doc comment could be softened in
  a follow-up — but that is a kernel-card edit, out of scope here (this card only reads
  the contract unless S1 forces otherwise).
