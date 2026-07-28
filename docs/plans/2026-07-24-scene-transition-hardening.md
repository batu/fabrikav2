# Scene Transition Hardening & Consolidation Proposal

Status: v2 — revised after dual review (2026-07-24). Reviewed by Claude (adversarial
subagent) and Codex gpt-5.6-sol; both returned **adopt-with-changes** with convergent
findings. §"v2 revisions" below supersedes the matching parts of the original proposal,
which is kept for context.

## v2 revisions (agreed by both reviewers)

1. **DOM-only session controller, not a Phaser-aware two-strategy engine.**
   `packages/ui` has no Phaser dependency and its convention (see ToastSystem) is no
   hardcoded game DOM ids. The shared piece is a handle-based `SceneTransitionSession`
   controller owning: transition-scoped generation/state (no module-level `let` — vitest
   module cache makes globals flaky), min-visible gating, reduced-motion collapse,
   exactly-once idempotent teardown with `try/finally`, and explicit
   `complete()` / `supersede()` / `abort()` (cancel-as-teardown conflates supersession
   with navigation reversal). Phaser RENDER wiring stays in the game adapter:
   `scene.events.once(RENDER, () => session.destinationRendered())`. Injected:
   `assetsReady` promise (game-local `whenIconsDecoded`), element getters
   (overlay/home-shell/container).
2. **Keep both visual treatments per-game for now; no strategy interface yet.** Share only
   the lifecycle controller first; both games' visual drivers (live-fade, clone-fly-out)
   stay local and call into it. Introduce a strategy abstraction only if the adapters prove
   a stable shared seam. Codex's stronger option — standardize future games on live-fade
   and retire clone-fly-out entirely — is a product call, left open.
3. **Attribute contract downgraded to participation-only.** `data-transition-exit` marks
   *which* elements fly (fixing the silent blink-out); transform geometry (safe-area
   `env()` math, per-element scale/rotation/distances, the revealing/clearing two-phase
   opacity split) stays in per-game CSS keyed off the state attribute. No geometry in
   markup. The contract must also mandate suppressing idle animations on participating
   elements (id-selector keyframe animations beat transition transforms — see marble_run's
   `#home-play-now { animation: none }` fix).
4. **Timing: CSS variables for values, timers stay authoritative for sequencing.** The
   engine must remain setTimeout-driven — `transitionend` never fires under
   `transition: none` (reduced motion) or in happy-dom, and WebKit cancels animations when
   backgrounded; a `getAnimations().finished`-with-watchdog upgrade is optional later.
   Reduced-motion keeps its dual TS+CSS collapse (the `@media` shorthand overrides discard
   the variables by design). Set variables synchronously at cover/overlay creation.
5. **Corrections to the original claims.** (a) Call sites are NOT unchanged: teardown
   ownership differs — marble_run's HomeScene transfers `boardPreview`/home teardown/
   `initHUD` into `onTeardown` with a `playEntryHandoff` shutdown flag; shell_template
   tears down immediately and relies on the clone. Migrating shell to the shared seam
   restructures its HomeScene shutdown. (b) The 120 ms RENDER fallback is a degraded path,
   not render-gating — if the timeout wins, the real RENDER is ignored; the session should
   record which signal fired and detach listeners on scene shutdown. (c) Consumers must be
   enumerated: find_the_dog (and every other game) has its own fork; "follows from the
   template" does not harden existing forks.
6. **Test boundary + device gate stated explicitly.** Package tests (vitest + happy-dom +
   fake timers, per existing EconomyTransfer/ToastSystem precedent) cover ordering
   invariants only: back-to-back starts, cancel during hold/reveal, teardown-throws,
   supersede-flush, reduced motion, scene-shutdown-before-render, repeated completion.
   MRV2-31 renderer-proofness is verifiable ONLY by on-device capture (the bug is
   WebKit-compositor-only): migration steps 1–2 each end with a physical-device gate
   (Pixel first, iPhone second, per repo device-acceptance convention), plus a guard test
   that marble_run's generic cover stays deliberately empty (v1-parity guard culture).
7. **Standing constraint.** A prior directive exists: "Do not modify the shell transition
   mechanism again" (from the marble_run transition-recovery work — root causes there were
   home-structure incompatibilities, not the mechanism). This consolidation is a mechanism
   change and needs Batu's explicit go-ahead superseding that directive before step 2
   touches shell_template.

### Revised migration order

1. Characterize marble_run's current state machine with tests → extract the DOM-only
   session controller into `packages/ui` (behavior-preserving; CSS untouched) → port
   marble_run's local driver onto it → on-device capture gate (incl. interruption/
   background cases).
2. Port shell_template's local clone-fly-out driver onto the controller (restructuring its
   HomeScene teardown to the handoff contract) + participation-attribute annotation →
   device gate.
3. Port remaining game forks one by one (find_the_dog next as known-good reference); each
   is a real migration, not template inheritance.

---

## Original proposal (v1, for context)

## Context

fabrikav2 is a monorepo of Phaser 3 + DOM-hybrid mobile games (Capacitor WebView). Each game
(`games/<name>`) is scaffolded by copy-forking `games/shell_template`. Shared code lives in
workspace packages; every game already depends on `@fabrikav2/ui` (components as
`Component.ts` + `Component.test.ts`, shared `ui.css`).

The menu→gameplay ("play-entry") transition is implemented per game in
`src/ui/SceneTransitionCover.ts`, called from `HomeScene.startGameScene()` and gated in
`GameScene` on the Phaser RENDER event. Two divergent implementations exist:

1. **shell_template (canonical)** — clone-and-cover: clones `#home-shell` into a full-screen
   cover, fades a near-black veil, starts GameScene underneath, waits for RENDER +
   double-rAF + `MIN_VISIBLE_MS` (650ms), then CSS-flies each cloned element off-screen
   (title up, rails out ±7°, nav down; `transform 900ms cubic-bezier(0.33,0,0.67,1)`).
   Selectors are hardcoded (`.home-title-panel`, `.home-rail-left`, …). Timing constants in
   TS must match CSS durations by hand.

2. **marble_run (fork, ticket MRV2-31)** — live-fade: no clone. Keeps the live `#hud-overlay`
   mounted (menu made `inert`), starts GameScene, then a single
   `opacity 520ms ease-in-out` fade of the whole overlay reveals the board. A required
   `onTeardown` callback fires only after the fade completes (disposes board preview, clears
   `#home-shell`, `initHUD()`), with a `playEntryHandoff` flag so scene shutdown doesn't
   destroy the home DOM early. Motivation: a WebKit bug where the cloned cover blanked to an
   empty purple field mid-transition; the live-DOM fade is renderer-proof. State machine uses
   `data-play-entry-state` on the overlay + a generation counter + `cancel()` that flushes
   pending teardown.

Both keep identical exported function names and call sites — the API surface is already
uniform; only internals diverge.

## Problems

- P1: Invariant-heavy machinery (state machine, reveal gating, teardown ordering,
  reduced-motion) is copy-forked N times; fixes like MRV2-31 don't propagate.
- P2: Fly-out choreography is coupled to menu DOM via hardcoded selectors; menu redesigns
  (a saga-style home redesign is in flight) silently break it — unmatched elements blink out.
- P3: Timing lives twice (TS constants + CSS durations) and must be kept in sync by hand.
- P4: No tests on the transition invariants that have already regressed in the field
  (MRV2-31; transition-cover stalls seen in device-lane QA).

## Proposal

### 1. One engine, two strategies, in `packages/ui/src/SceneTransition.ts`

Engine owns what both implementations agree on:
- state machine + generation counter (adopt marble_run's, it is tighter)
- RENDER-event + double-rAF + `MIN_VISIBLE_MS` reveal gate
- the teardown-handoff contract: `onTeardown` fires only after reveal completes (promote
  marble_run's MRV2-31 fix to the shared contract)
- `cancel()` that flushes pending teardown; reduced-motion collapse; HUD-enter helpers

Visual treatment is a pluggable strategy behind one interface:
- `liveFade` — marble_run's renderer-proof opacity fade (zero visual change for marble_run)
- `cloneFlyOut` — shell_template's choreography (inherits the hardened seam)

Per-game selection + tuning via a config object.

### 2. Attribute-driven choreography

Replace hardcoded selectors with a declaration contract on menu elements:
`data-transition-exit="up|down|left|right"` (+ optional `data-transition-exit-rotate`).
The `cloneFlyOut` strategy animates whatever declares itself, ignores the rest. Menu
redesigns and per-game menu tweaks then need no transition edits; new games opt elements in
by annotating markup.

### 3. Timing single-source-of-truth

Engine sets CSS custom properties (`--transition-reveal-ms`, …) on the cover/overlay;
shared CSS in `ui.css` consumes only the variables. Per-game tuning becomes a config
override (`revealMs: 520`), not a paired TS+CSS edit.

### 4. Guard tests + thin per-game adapters

- `packages/ui/src/SceneTransition.test.ts` (package convention): state ordering; teardown
  never fires before reveal completes; cancel flushes teardown; reduced-motion collapse.
- Each game's `src/ui/SceneTransitionCover.ts` becomes a ~20-line adapter importing from
  `@fabrikav2/ui` and passing config (strategy, timings, teardown closure). Existing
  HomeScene/GameScene call sites unchanged.

### Migration order

1. Extract engine + `liveFade` into `packages/ui`; port marble_run; verify no visual diff.
2. Implement `cloneFlyOut` with the attribute contract; port shell_template; annotate its
   menu elements.
3. Remaining games follow from the template as usual; `shell_template` stays the reference
   consumer so future scaffolds get the shared version by construction.

### Convention note

Repo convention is "ports are copy-paste-and-integrate" per game. This design keeps the
per-game file a simple copyable adapter while moving invariant-heavy machinery to the
package tier, where `@fabrikav2/ui` already establishes shared code as accepted practice.

## Review ask

Critique this proposal as a senior engineer familiar with template-forked game monorepos:
- Is the engine/strategy split the right cut, or over-abstraction for 2 strategies?
- Risks in migrating marble_run first? In the attribute contract? In CSS-variable timing?
- Anything the migration order gets wrong (e.g. WebKit/Capacitor pitfalls, Phaser scene
  lifecycle races, reduced-motion, interrupted transitions, back-to-back triggers)?
- Simpler alternative that still fixes P1–P4?
Be concrete; reference the file paths above where useful.
