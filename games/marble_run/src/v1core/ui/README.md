# @fabrika/core/ui — UI component contract (A-UI0)

Vanilla-DOM, framework-agnostic UI components shared across games. A new game
**pulls in a component and wires it** — copy, colors, art differ per game; the
structure/behavior stay identical. This is the keystone every later component
(menu, end screens, share, HUD, transitions) conforms to.

> Import via the subpath only: `import { mountRatePrompt } from '@fabrika/core/ui'`
> and `import '@fabrika/core/ui.css'`. **Never** re-export from the top-level
> `@fabrika/core` barrel — that would drag DOM/CSS code into logic-only test graphs.

## Fonts (`@fabrika/core/ui/fonts`)

Two shared primitives dedupe what every game used to hand-roll (font-stack
literal + FOUT avoidance). Imported via their own subpath, **not** the `./ui`
barrel: `import { FONT_STACK, ensureFontsLoaded } from '@fabrika/core/ui/fonts'`.

- **`FONT_STACK`** — the single canonical CSS font-family string
  (`'Nunito', sans-serif`). It is kept **byte-identical** to the
  `--fab-font-family` token default in `ui.css`; a unit test
  (`fonts.test.ts`) reads the token out of `ui.css` and asserts the two match,
  so they can't drift. A game sources its font constant from here
  (e.g. block_blast's `UI.FONT_FAMILY: FONT_STACK`) instead of re-declaring a
  stack literal.

- **`ensureFontsLoaded(opts?)`** — a `FontFaceSet`-based readiness guard a game
  awaits before its first text paint so text renders in the web font, not a
  fallback (no FOUT). Options: `families` (default `['Nunito']`), `weights`
  (default `[400, 700, 800, 900]`), `timeoutMs` (default `3000`). It is
  **fail-open**: if the FontFaceSet API is absent (SSR / old WebView) it returns
  immediately, and if the fonts never settle it resolves on the timeout rather
  than rejecting — first paint must never hang on a font. block_blast awaits it
  in `BootScene.create()` before starting `MenuScene` (the first text-rendering
  scene).

**Delivery stays CDN — core does not self-host.** Nunito ships via each game's
Google Fonts `<link>` in `index.html`. There is deliberately **no** self-hosted
`@font-face` in `ui.css`: adding one for `Nunito` would shadow the CDN font the
live, frozen games (`find_the_dog`, `marble_run`) resolve at runtime, and there
are no Nunito `.woff2` assets in the repo to host. If true self-hosting is ever
wanted, that's a separate, release-risk change for the frozen games — not this
module.

## The contract

A component is a render function `(opts) => UiHandle` taking the **slot-quartet**
(use the slots a component needs):

| Slot | What | Rule |
|------|------|------|
| `theme` | `--fab-*` token values (`ThemeTokens`) | applied to the component root via `applyTheme` |
| `content` | copy + counts + which-elements-present, typed per component | injected as **data** (`textContent`/`setAttribute`), never markup |
| `actions` | callbacks (`onAccept`, `onDecline`, …) | the component calls them; side effects live in the consumer |
| `state` | injected read-model | **never** `import gameState` — inject it |

**Scope of the quartet:** this is the contract for **DOM-overlay** components —
modal/overlay surfaces mounted into a game's HUD DOM (RatePrompt, LevelMap,
LevelComplete). Non-overlay shared code (pure helpers, Phaser-layer utilities)
does not adopt the quartet; it's an ordinary module.

**Where a value goes — theme vs content:**

- **`theme` tokens** carry everything that is *skin*: colors, sizes, **art URLs**
  (`--fab-<component>-*-url`, applied as `<img src>`/background; default `none` so
  an un-themed mount degrades to no-art, not broken layout), and **timings** the
  component's JS reads off the root (so a consumer's env-gated values — e.g. a
  fast-E2E mode — arrive as tokens and core never touches `import.meta.env`).
- **`content`** carries copy/labels, counts, and which optional elements render
  (e.g. `claimDouble?`). Data only — set via `textContent`/`setAttribute`, never
  interpolated into `innerHTML`. An icon that would otherwise need markup is an
  art **token** (`<img src>`), not a content markup string.

`UiHandle = { el, dismiss(), dismissed: Promise<void> }`. Components must clean up
on `dismiss()` (remove DOM, clear timers/intervals, resolve `dismissed`) for the
canvas-overlay lifecycle. Component-specific handles may extend it, but the base
handle stays small; for example `mountButton` adds `setDisabled()` and
`setLabel()` only on its own `ButtonHandle`.

### Token namespace convention

Component-specific tokens are namespaced `--fab-<component>-*` (e.g.
`--fab-levelmap-node-size`, `--fab-complete-reward-reveal-ms`). Cross-component
*semantic* roles stay bare (`--fab-color-accent`, `--fab-space-md`,
`--fab-radius-pill`, `--fab-font-*`). A component reuses the bare semantic tokens
where the source did, and adds `--fab-<component>-*` for values unique to it.
Component rules keep structural layout values in CSS, but skin-bearing values
(surfaces, borders, text colors, shadows, gradients, and JS-read timings) must be
tokens so a new game can reskin without editing core rules.

### Shared lifecycle helper (`createUiRoot`, internal)

All three components route their mount lifecycle through one private helper,
`createUiRoot` (id-resolution + the re-entrancy `MOUNTED` WeakMap + the
`dismissed` promise + idempotent `dismiss` + `appendChild`/register). It also
provides an `AbortSignal` (aborts on dismiss) and a tracked `scheduleTimeout` /
`registerCleanup` registry (all timers cleared on dismiss) — the timer-heavy
LevelComplete needs these; the timer-free RatePrompt/LevelMap ignore them. New
DOM-overlay components should build on `createUiRoot` rather than re-rolling the
boilerplate (it's the refactor-on-third outcome).

**Hard rule:** core/ui imports no game state, audio, platform, or
`import.meta.env`. Those stay in the consumer and arrive via `actions`/`content`.
(That's also how the `import.meta.env`-into-core typecheck hazard is avoided.)

## Theming

Two-tier CSS custom properties. The **semantic tier** is the override contract;
consumers set semantic tokens only — never edit rules (if a reskin needs a rule
edit, that's a contract gap → promote the value to a token).

- All vars are namespaced `--fab-*` and scoped to a `.fab-ui` class (never bare
  `:root`) so they can't leak/collide in a game's shared overlay DOM.
- Core defaults are deliberately **brand-neutral**: gray surfaces, neutral
  shadows, generic gradients, and generic beat timings. They are coherent enough
  for a fresh game to mount a component while it builds its own skin, but they
  are not intended to carry any shipped game's identity.
- **Token defaults live in the `.fab-ui` rule in `ui.css`** — so importing
  `ui.css` is a hard precondition, and any token a consumer doesn't override
  keeps its default (a partial theme degrades gracefully; a *missing* `ui.css`
  does not — components render unstyled).
- `applyTheme(root, tokens)` tags `root` with `.fab-ui` and sets the overrides
  as inline custom properties. Inline `setProperty` is the **active** override
  mechanism (it outranks any stylesheet rule). `ui.css` is wrapped in `@layer`
  (`fab.tokens`, `fab.components`) so a *future* consumer that themes via a
  plain CSS rule (rather than `applyTheme`) also wins without `!important` —
  belt-and-braces, not the primary path today.
- Components use fresh `.fab-*` class names (they don't touch a game's own
  `.modal-*`/`.btn-*`).

The recommended game path is a complete `ThemeTokens` map in the consumer,
spread into each mount's `theme:` option before any per-surface overrides:

```ts
mountLevelComplete({
  mountInto,
  theme: { ...MY_GAME_UI_THEME, ...MY_LEVEL_COMPLETE_THEME },
  content,
  actions,
});
```

See `games/find_the_dog/src/ui/ftdTheme.ts` for the reference implementation:
FTD's production skin lives there, while art/timing variants still live beside
their surface wrappers and override the shared skin by spread order.

Current cross-component semantic tokens (grow per component, don't pre-enumerate): color roles
(`surface`, `overlay-scrim`, `text`, `text-muted`, `accent`, `on-accent`,
`secondary-surface`, `on-secondary`, `secondary-border`), `space-{sm,md,lg}`,
`radius-{sm,md,pill}`, `font-{family,size-sm,size-md,size-lg,weight-normal,weight-bold}`,
`duration-fast`, `shadow-{modal,button,button-active,button-disabled}`, shared
button tokens `btn-{min-size,primary-padding,secondary-padding,icon-size,
disabled-opacity,line-height,secondary-shadow,icon-color,icon-shadow}`, and the
modal shell's skin/behavior tokens `modal-{backdrop-padding,backdrop-bg,
card-bg,card-shadow,backdrop-animation,card-animation}` (the two `*-animation`
tokens take a full `animation` shorthand or `none` — a pixel-frozen game sets
`none`, since even a finished fill-mode animation leaves a composited transform
that subpixel-shifts the card).

### Typed token mirror for canvas games (`@fabrika/core/ui/tokens`)

DOM games consume the tokens above as `--fab-*` CSS variables. Phaser/canvas
games render in-canvas where CSS variables are unreachable — they need numeric
`0x` colors and raw px numbers. `packages/core/src/ui/tokens.ts` is the **typed
mirror** of the neutral scalar defaults for those consumers.

- **Two tiers, one source of truth.** `ui.css` remains the *runtime* source for
  DOM consumers; `FabTokens` is the *canonical TS statement* of the same neutral
  scalar values for canvas consumers. They are the same numbers in two forms.
- **Scalar subset only.** Colors (`hex` + numeric `num`/`0x` form), `space-*`,
  `radius-*`, `font-*`, `duration-fast`. The ~150 composite tokens (multi-layer
  shadows, gradients, animation shorthands, art URLs, per-component groups) are
  **not** mirrored — they aren't meaningfully consumable as canvas numbers.
  `--fab-color-overlay-scrim` is mirrored string-only (an alpha color has no
  single `0x` form).
- **Alignment is enforced by a test, not codegen.** `tokens.test.ts` parses
  `ui.css` and asserts every mirrored token agrees byte-for-byte, plus that each
  color's `num` equals `parseInt(hex)`. There is no build step emitting one from
  the other and no runtime coupling. **Change protocol: edit `ui.css` and
  `tokens.ts` together — the drift test fails the build if you don't** (re-run it
  explicitly after any rebase, which can silently revert token values).
- **Import via the dedicated subpath `@fabrika/core/ui/tokens` — never through
  the `./ui` barrel.** The barrel is DOM code; a value import through it would
  drag DOM modules into a canvas game's (and its tests') import graph. `tokens.ts`
  is a pure data leaf with zero DOM/Phaser/`import.meta.env` imports.

```ts
import { FabTokens } from '@fabrika/core/ui/tokens';
scene.add.rectangle(x, y, w, h, FabTokens.color.surface.num); // 0xffffff
text.setColor(FabTokens.color.text.hex);                      // '#3d3d3d'
```

Current component-specific token groups:

- `--fab-levelmap-*`: rail layout, node colors, line/glow, loading placeholders,
  and per-state node art URLs.
- `--fab-rate-*`: rate-prompt card border/background/shadow, title/subtitle
  colors, and primary/secondary button skins.
- `--fab-complete-*`: level-complete art URLs, beat timings, overlay/card/reward
  surfaces, balance pill, reward burst, reward label, icon filters, and
  claim/next/2x button skins.
- `--fab-hud-*`: HUD-frame base padding (`pad-{top,left,right}`), slot `gap`, and
  the safe-area inset indirection (`safe-{top,left,right}`, default
  `env(safe-area-inset-*, 0px)`). All achromatic — the frame carries no hue.

## Components

- **`mountButton(opts)`** — a standalone vanilla `<button type="button">` using
  the shared `.fab-btn` classes. `opts`: `mountInto`, `label`, `onClick`,
  `variant?` (`'primary'|'secondary'|'icon'`, default `'primary'`), `disabled?`,
  `theme?`, `id?`, `ariaLabel?`, `className?`. Labels are assigned via
  `textContent`, never markup. Disabled state sets both the DOM `disabled`
  property and `data-disabled`. The returned `ButtonHandle` extends `UiHandle`
  with `setDisabled(disabled)` and `setLabel(label)`.

- **`mountModal(opts)`** — the shared modal shell:
  `.fab-ui.fab-modal-backdrop > .fab-modal-card[role="dialog"][aria-modal="true"]`.
  `opts`: `mountInto`, `title?`, `body?` (`HTMLElement` or readonly array),
  `actions?` (`ModalAction[]` or a caller-provided action element),
  `backdropDismiss?`, `onDismiss?`, `theme?`, `id?`, `labelledById?`,
  `describedById?`, `cardClassName?`. Core owns the shell and action button
  construction; caller-provided body/action elements carry game-specific content.
  Caller-provided body/action elements must be fresh, unparented nodes per mount;
  core fails fast instead of silently moving a node out of another open modal.
  `onDismiss` fires once for any dismissal path, after the modal root has been
  unregistered and removed, so a callback can synchronously mount a replacement
  with the same id. There is intentionally no focus trap, scroll lock, or modal
  stack manager yet — the current contract is one simple modal at a time, by
  id/re-entrancy.

- **`mountRatePrompt(opts)`** — one-shot rate-me modal. `opts`: `mountInto`,
  `content` (`title`/`subtitle`/`acceptLabel`/`declineLabel`), `actions`
  (`onAccept`/`onDecline`/`onInteract?`), `theme?`, `id?`. Re-entrant (same `id`
  while open = no-op). It composes the public modal shell and shared button
  builder while preserving its stable DOM hooks (`fab-rate-card`,
  `data-fab-action`). See `games/find_the_dog/src/ui/RatePrompt.ts` for the
  reference wiring (copy + theme + side effects injected by the game).

- **`mountLevelMap(opts)`** — the level-progression rail (zig-zag nodes, depth-
  fade, current scale-up, per-node state art, loading placeholder). The first
  component using the **`state`** slot: `opts.state.nodes` is an already-windowed,
  ordered (top→bottom) list of `{ id, label, name, state: 'current'|'locked'|
  'completed' }` with one `current`. **Core draws; the game windows** — the game
  maps its level data to nodes (which 5, which states) and hands them over; core
  owns placement, depth-by-distance-from-current, and click dispatch
  (`actions.onSelectLevel(id)` fires for any node — the game gates which are
  playable). Node art is per-game via `--fab-levelmap-art-*` image-URL tokens.
  See `games/find_the_dog/src/scenes/HomeScene.ts` (`buildLevelMapNodes` +
  `FTD_LEVELMAP_THEME`).

  *Stable DOM hooks (public, safe to query in tests/a11y):* each node button
  carries `data-fab-node-id` (the node's `id`) and `data-fab-node-index` (its
  position). These are part of the contract — renaming them is a breaking change.

- **`mountLevelComplete(opts)`** — the level-complete celebration. Core owns the
  PRESENTATION + SEQUENCING (modal scaffold, entrance, reward-reveal, JS-driven
  side confetti, the reward zone + earned-counter drain, the button hierarchy
  Claim / Claim-2x? / Next, rotating messages, and the beat timing); the game
  injects MEANING via callbacks. `content`: rotating `messages`, `rewardLabel`,
  `rewardAmount`, `balanceBefore`, button labels, and `claimDouble?` (present →
  render the 2x button). `theme`: `--fab-complete-*` art URLs + the six beat
  timings. `actions`: `onClaim(transfer)`, `onClaimDouble?(signal)`,
  `onNext(signal)`, `onInteract?`. No `state` slot — it's fire-once (counts are
  content fixed at open; the reveal progression is internal). See
  `games/find_the_dog/src/ui/LevelCompleteOverlay.ts` for the reference wiring
  (a thin wrapper: economy/grant/rate-prompt/advance/audio all injected).

  *The coin-fly DOM seam.* Core sequences the celebration but does **not** own the
  economy. When the player claims, core drains the earned counter and calls
  `onClaim(transfer)` where `transfer: CoinTransfer` hands the game the
  core-owned DOM nodes its coin-fly animates against — `source` (the reward
  element), `balanceCountEl` (the balance pill count), `root` — plus `amount`,
  `targetBalance`, `tokenMultiplier`, `reducedMotion`, and an `AbortSignal`. The
  game runs its fly (FTD's `animateCoinsToBalance`) against those nodes; core
  reveals Next when `onClaim` resolves. This is the documented, intentional leak
  that keeps the celebration reusable while the economy stays per-game.

  *Async-callback rule.* `onClaim` / `onClaimDouble` / `onNext` are game-injected
  and may reject or never resolve — core wraps each in try/catch (never strands
  the player) and passes `signal`; any callback work after an internal `await`
  MUST check `signal.aborted` before touching DOM/state (the per-closure
  `el.isConnected` guard a single-file overlay got for free is gone across the
  boundary).

- **`mountTransitionCover(opts)`** — a full-bleed scene-transition cover that
  masks a screen-to-screen swap (e.g. a Phaser scene teardown) so the destination
  is revealed already-painted. `opts`: `mountInto`, `content?` (`imageSrc?` /
  `imageAlt?` — the centred artwork; omit for a plain panel), `minVisibleMs?`
  (default 650), `assetsReady?` (extra readiness held for in `hideAfterPaint()`,
  on top of the always-awaited `document.fonts.ready`), `assetsReadyCapMs?`
  (default 1500), `theme?`, `id?`. The returned `TransitionCoverHandle` extends
  `UiHandle` with `hide()` (min-visible-respecting fade-out then remove +
  `dismissed`) and `hideAfterPaint()` (hold for fonts + `assetsReady`, capped,
  then double-rAF reveal → `hide()`); `dismiss()` is immediate teardown. Colour,
  art sizing/filter, and the bob motion are token-driven (`--fab-transition-*`);
  the neutral defaults carry no game branding. Re-entrant (same `id` while
  mounted = the live handle, no duplicate).

  *Contract — input shield, not a modal.* The cover is `aria-hidden="true"` with
  `pointer-events: auto` (it blocks input during the swap). It deliberately makes
  **no** modal/focus claims — no focus trap, no `role="dialog"`, no scroll lock.
  Treat it as a visual + input barrier only. The Phaser-side reveal-on-render
  hook (FTD's `hideSceneTransitionCoverAfterSceneRender`) is intentionally NOT
  here — the cover stays Phaser-free; that hook ships with the FTD migration,
  next to its adopter. For the fade-out→`scene.start` half of a transition, use
  `fadeThenStart` from `@fabrika/core/puzzle/juice` (Phaser-coupled, kept off
  this DOM-only package).
- **`mountHudFrame(opts)`** — the slot-based top-bar frame. A `space-between`
  flex row with three caller-provided slots (`left` / `center` / `right`, each
  `HTMLElement` or a readonly array), owning the `env(safe-area-inset-*)` padding
  recipe once (copied read-only from FTD `.hud-top-bar` + the marble donor and
  generalized to three slots — a caller passing only `left` + `right` reproduces
  the donors' two-slot layout, since the empty center child collapses to zero
  width). `opts`: `mountInto`, `left?`, `center?`, `right?`, `theme?`, `id?`,
  `className?`. Re-entrant by `id`; returns the standard `UiHandle`. All three
  slot containers (`.fab-hud-left/-center/-right`) always render; caller-provided
  slot elements must be fresh (unparented) — core throws rather than reparent a
  live node.

  *The frame is a FLOW element* — it owns only its internal layout + safe-area
  padding, **not** its placement. The caller wraps it in its own shell (a fixed
  overlay, a header region, etc.); this keeps the primitive adoptable by donors
  with differing shells (FTD's padding-based bar, marble's fixed-position bar). It
  carries no hearts/coins/gear/level-pill widgets — those are caller-supplied
  elements handed to the slots.

  *The safe-area seam.* The recipe is
  `calc(var(--fab-hud-safe-*) + var(--fab-hud-pad-*))`, and `--fab-hud-safe-*`
  defaults to `env(safe-area-inset-*, 0px)`. On a non-notch device the safe term
  is `0` and padding equals the base — the recipe is a no-op, not a constant
  offset. A consumer (or a test) that must **force** an inset — a platform whose
  `env()` is unreliable, or a headless browser with no notch — overrides
  `--fab-hud-safe-*` with a fixed value via `theme`, and padding becomes
  `inset + base`. This is the injection hook the Playwright harness uses to prove
  the recipe deterministically (see `packages/core/tests/harness/`). No DOM
  adopter exists yet: rewiring FTD/marble top bars onto the frame is a deferred
  follow-up (both games are frozen).

### Stateful components & `update()`

`mountLevelMap` takes the `state` slot at mount. There is intentionally **no
in-place `update(state)`** yet: FTD's `HomeScene` rebuilds its whole overlay per
render and re-mounts the rail, so a granular patch API would have no consumer.
When a component genuinely needs to patch in place (e.g. a HUD updating a coin
balance without a full rebuild), add `update(state)` on that component's own
handle (`interface HudHandle extends UiHandle { update(s): void }`) — do **not**
widen the base `UiHandle`.

## Testing a component (the A-UI0 pattern)

1. **Characterization first.** Before extracting/changing a component, capture a
   behavioral spec (callbacks fire, promise resolves, cleanup) + a visual golden
   (`toHaveScreenshot` scoped to the component's card locator, from a standalone
   harness that mounts only the component — no game boot). Determinism:
   `document.fonts.ready`, `animations:'disabled'`, reduced motion, fixed
   viewport/DPR, `scale:'css'`.
2. **Parity is the gate.** After the change, the behavioral spec stays green and
   the golden matches within tolerance.
3. Cross-env CI visual baselines must be regenerated in the pinned
   `mcr.microsoft.com/playwright` container (commit only the `-linux` PNG).
