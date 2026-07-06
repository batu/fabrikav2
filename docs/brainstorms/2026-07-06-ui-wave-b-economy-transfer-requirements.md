---
title: "packages/ui wave B — EconomyTransfer coin-fly, canvas↔DOM coordinate bridge, ConnectivityIndicator, micro-utils"
date: 2026-07-06
trello: https://trello.com/c/TlFpa0ax
card: TlFpa0ax
stage: brainstormed
depends_on: Fw1NtsCr
status: requirements-locked
---

# Wave B UI extraction — requirements

Grounded read of the v1 seeds (all under `/Users/base/dev/appletolye/fabrika`,
READ-ONLY). Line references verified directly, not trusted from the card.

## 1. What this card ships (scope)

Four disjoint additive modules into `packages/ui/src/**`, plus `ui.css`
additions and tests. No edits to wave A files beyond additive re-exports in
`index.ts`. DOM-only, `--fab-*` tokenized, **zero literal colors / copy /
asset paths** (guardrail #2, v2-architecture.md:52-54).

1. **EconomyTransfer** — port of `games/find_the_dog/src/ui/EconomyTransfer.ts`
   (301 lines: rAF + quadratic Bézier flight, stagger, MutationObserver
   cancellation, count-up). The marble_run copy
   (`games/marble_run/sugar3d/src/ui/dom.ts` `animateCoinToken()` L676 +
   wrapper L404 — identical magic numbers `drift=84`, `760ms`, verified in
   grader 08 §48 at dom.ts:690,695) is the one that "dies"; FTD's is canonical
   (research 04 claim 8).
2. **Canvas↔DOM coordinate bridge** — `resolveDomAnchorToCanvasPoint(...)`,
   generalizing `counterTargetPoint()` (GameScene.ts:2254-2271). This is the
   load-bearing cross-substrate primitive the coin-fly's `to`-target depends on
   (grader 08 "Most significant miss", R43/R44).
3. **ConnectivityIndicator** — port of `initConnectivityIndicator()`
   (HUD.ts:1426-1441): `navigator.onLine` + online/offline listeners.
4. **Micro-utils** — `prefersReducedMotion()` (one export, dedup ×3) and
   `retriggerCssAnimation(el, className)` (from `pulseDogCounter`
   GameScene.ts:2300-2306).

## 2. Verified v1 facts that shape the port

- **Reduced-motion is triplicated verbatim.** Identical
  `window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false` at
  `GameScene.ts:1907-1908`, `EconomyTransfer.ts:252`, and
  `packages/core/src/ui/index.ts:517` (card said `:511` — actual is `:517`).
  → one `prefersReducedMotion()` export.
- **The reflow-retrigger pattern is duplicated too.** `pulseDogCounter`
  (GameScene.ts:2300-2306) and `bumpTarget` (EconomyTransfer.ts:233-237) both do
  `remove class → void el.offsetWidth → add class`. → one
  `retriggerCssAnimation(el, className)`; `bumpTarget` calls it.
- **Two different anchor attributes exist, playing two different roles:**
  - `data-economy-anchor="<kind>"` (EconomyTransfer.ts:72) — marks the *precise
    sub-element* (the glyph) inside a target container to fly toward.
  - `data-economy-target="hints"` (EconomyTransfer.ts:298) — marks a *container*
    as a valid landing target, used inside a hardcoded selector list.
- **Literals that must be de-hardcoded** (all zero-literals violations if ported
  as-is): asset paths `TOKEN_IMAGE_BY_KIND` (L16-19), the target selector lists
  in `animateCoinsToBalance`/`animateHintsToBalance` (L290, L298 — literal ids
  `#coin-pill`, `#hint-btn`, classes `.home-coin-pill`, etc.), and in
  ConnectivityIndicator the toast copy `'Back online'` /
  `'Offline — playing cached levels'` (HUD.ts:1435,1439) plus the element id
  `'offline-indicator'`.
- **`counterTargetPoint` uses an anchor fraction, not the center:** it targets
  `left + width*0.34`, `top + height*0.5` (GameScene.ts:2268-2269) and scales by
  `GAME.WIDTH/HEIGHT`. The grader's suggested API already parameterizes the
  logical size: `resolveDomAnchorToCanvasPoint(el, canvas, logicalW, logicalH)`
  (grader 08 §59.2).

## 3. Decisions (locked for the plan/work stages)

### D1 — Anchor attribute: keep both roles, namespace both, inject the targets
The card says "pick one, document". The two attributes are *not* redundant —
one selects a landing container, the other the glyph inside it. Collapsing to
one loses the sub-element precision the Bézier endpoint needs. **Decision:**
standardize the *names* under the `fab-` namespace (matching `--fab-*`):
- `data-fab-economy-target="<kind>"` — a container eligible as a landing target.
- `data-fab-economy-anchor="<kind>"` — the precise glyph within it to fly to.
The **target selector list is injected** via `options.targets` (already an
option in v1); the hardcoded convenience wrappers' literal selector arrays do
**not** move into `ui` — a consumer passes them. `visibleTransferAnchor`'s
fallback selector becomes `[data-fab-economy-anchor="${kind}"]` then `img` then
center. Document the two attributes in the module header + README.

### D2 — Injected assets, not asset-path literals
`animateEconomyTransfer` takes an injected `tokenImage: string` (the consumer
resolves the coin/hint glyph URL from the generated asset module). No
`TOKEN_IMAGE_BY_KIND` map in `ui`. `kind` stays as an enum only for the
CSS class suffix + token-count heuristic, not for asset resolution.

### D3 — Coordinate bridge: port only the substrate-free transform into `ui`
`counterTargetPoint`'s DOM-rect→normalized→logical math is pure and DOM-only —
that becomes `resolveDomAnchorToCanvasPoint(el, canvas, logicalW, logicalH,
anchor?)` where `anchor = {x,y}` fraction defaults to `{x:0.5,y:0.5}` (pass
`{x:0.34,y:0.5}` to reproduce FTD's dog-counter). Returns `null` on zero-size
rects (v1 returned a fallback point; a `null` return lets the caller choose the
fallback — cleaner for a shared util). **`viewportToScrollFactorZeroPoint`
(2244-2252) and `levelToViewportPoint` (2236-2242) are Phaser-camera-coupled**
(`this.cameras.main`, `imgOffsetX`, `imgScale`, `camera.zoom`) — they are *not*
DOM-only and **do not belong in `packages/ui`**. Port only the bridge the
coin-fly actually needs; note the camera transforms as game/kernel-substrate
concerns in SURPRISES for a later kernel card. (If the plan stage wants them
here anyway, they must be rewritten as pure functions over a plain
`{scrollX, scrollY, zoom, originX, originY, width, height}` descriptor — no
Phaser import in `ui`.)

### D4 — ConnectivityIndicator: injected copy + injected callbacks
`mountConnectivityIndicator(options)` where options carry: `mountInto`, the
online/offline **copy strings** (injected), and an injected `onToast(msg)`
callback (v1 called `showToast` directly — in `ui` the toaster is wave A's
`mountToaster`; wire via callback, don't hard-depend). Owns its indicator
element (a `--fab-*`-tokenized dot/icon) instead of `getElementById('offline-
indicator')`. Returns a `UiHandle`-shaped object whose `dismiss()` removes the
`online`/`offline` window listeners (v1 leaks them — fix on the way out).

### D5 — Micro-utils home
New `motion.ts`: `prefersReducedMotion(): boolean` and
`retriggerCssAnimation(el: HTMLElement, className: string): void`. Both
re-exported from `index.ts`. `EconomyTransfer` consumes both; ConnectivityIndicator
consumes neither (no motion).

## 4. File plan (all new; additive index exports only)

```
packages/ui/src/EconomyTransfer.ts          # animateEconomyTransfer(options)
packages/ui/src/EconomyTransfer.test.ts
packages/ui/src/canvasDomBridge.ts          # resolveDomAnchorToCanvasPoint(...)
packages/ui/src/canvasDomBridge.test.ts
packages/ui/src/ConnectivityIndicator.ts    # mountConnectivityIndicator(options)
packages/ui/src/ConnectivityIndicator.test.ts
packages/ui/src/motion.ts                    # prefersReducedMotion, retriggerCssAnimation
packages/ui/src/motion.test.ts
packages/ui/src/ui.css                       # ADD: .economy-transfer-* + connectivity rules (var(--fab-*) only)
packages/ui/src/index.ts                     # ADD: re-exports (no edits to existing lines)
```

Motion tuning constants (`760ms`, `42ms` stagger, `84` drift, `88+74` lift,
easing exponents, `tokenCount` bounds) are **named module consts**, not magic
literals — they are motion tuning, not colors/copy/assets, so they are allowed
in `ui` but must be named. `--fab-*` tokens cover any color/size that renders.

## 5. Acceptance criteria (card AC, made concrete)

- `npm run typecheck --workspace=packages/ui` clean.
- `npm run test:unit --workspace=packages/ui` green, including:
  - reduced-motion branch: `reducedMotion:true` → count set instantly, **no
    tokens spawned**, promise resolves immediately (EconomyTransfer.ts:258-260).
  - `prefersReducedMotion()` returns the matchMedia value and `false` when
    `matchMedia` is absent.
  - `retriggerCssAnimation` removes then re-adds the class (reflow forces
    restart).
  - `resolveDomAnchorToCanvasPoint` math: known rect → known logical point;
    `null` on zero-size; anchor-fraction override.
  - token-count heuristic bounds (`tokenCount` L89-95).
  - MutationObserver cancellation: removing the owner/target aborts in-flight
    tokens (isLive → cancel).
  - ConnectivityIndicator: `offline` event toggles the indicator + fires
    injected `onToast` with the **injected** copy; `dismiss()` unregisters
    listeners.
- **Zero literal colors / copy / asset paths** in the four modules (grep-clean
  of `#`-hex, quoted asset URLs, and user-facing copy — all injected/tokenized).

## 6. Verification command

```
npm run typecheck --workspace=packages/ui && npm run test:unit --workspace=packages/ui
```

## 7. Risks / surprises to carry forward

- **S1 — camera transforms don't fit DOM-only `ui`.** Only `counterTargetPoint`
  is substrate-free; `viewportToScrollFactorZeroPoint` + `levelToViewportPoint`
  are Phaser-coupled. Ported bridge = the coin-fly's real dependency only; the
  camera pair is deferred to a kernel/game card (see D3). This narrows the
  card's "put all three in ui" instruction — flagged, not silently done.
- **S2 — line-number drift.** `core/ui/index.ts` reduced-motion is `:517` not
  the card's `:511`. Everything else matched.
- **S3 — jsdom gaps.** `getBoundingClientRect` returns zeros and there is no
  real rAF/paint in jsdom; tests must stub rects and drive rAF (fake timers /
  manual `requestAnimationFrame` shim), mirroring wave A's approach. The
  `FAST_E2E_UI` env branch (EconomyTransfer.ts:21-23) is a v1 e2e hook — replace
  with an injected/`options`-level fast-path or a test-only duration override
  rather than an `import.meta.env` literal.
- **S4 — listener leak fix.** v1's connectivity listeners are never removed;
  the `ui` version owns teardown (D4). This is a behavior *improvement*, noted
  so review doesn't read it as scope creep.
- **S5 — marble_run copy path.** Lives under the `sugar3d/` subdir
  (`games/marble_run/sugar3d/src/ui/dom.ts`), not `games/marble_run/src` — a
  top-level grep misses it. Dedup evidence only; nothing to port from it.
