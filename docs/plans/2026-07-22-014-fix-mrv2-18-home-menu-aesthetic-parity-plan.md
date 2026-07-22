---
title: "MRV2-18 — Home menu aesthetic parity (preview 3D camera, chain density, composition, confetti)"
type: fix
status: planned
origin: card description (MRV2-18 h369vqly — no brainstorm doc; Batu verdict "the UI is trash, menu especially")
trello: card h369vqly (MRV2-18) — board twf pipeline, column planned
date: 2026-07-22
scope_fence: games/marble_run/** only — no packages/ui edits, no PRs
---

# MRV2-18 — Home menu aesthetic parity

## Problem

The structural judge passed but Batu rejected the v2 home menu: it reads sparse
and flat next to v1. Four concrete aesthetic gaps vs the v1 canonical
(`scratchpad/refs/home-fresh.png`, iPhone) show in the v2 capture
(`scratchpad/pixel-v2-launch.png`, Pixel):

1. **Board preview geometry** — v2 renders a flat 45° diamond; v1 is a large,
   slightly-rotated 3D board with visible wooden-frame depth.
2. **Saga chain density** — v2 nodes read small, gaps too loose, rail is a thin
   gray line instead of v1's wooden path.
3. **Composition** — v2 LEVEL button is near-full-bleed; v1 insets it. Sun node
   sits above; overall vertical balance is off.
4. **Life** — v2 is missing v1's ambient confetti/sprinkle layer and the bubble
   texture reads thinner.

## Canonical source (ground truth)

v1 Sugar3D: `/Users/base/dev/appletolye/fabrika/games/marble_run/sugar3d`
(recorded as `docs/asset-manifest.json` `v1Root`). Port params verbatim — do not
approximate.

## Root-cause findings (verified against v1 + v2 source)

### Defect 1 — preview camera (ROOT CAUSE FOUND)
- v1 `src/App.ts:45` sets `cameraYawDeg: 90` for the whole app (`DEFAULT_DEBUG_TUNING`).
- v2 `src/three/Stage.ts:26` defaults `cameraYawDeg = 45`. `HomeBoardPreview`
  (`src/menu/HomeBoardPreview.ts`) constructs its **own** `new Stage(canvas)` and
  never overrides the yaw, so the decor board renders at 45° → the flat diamond.
- At yaw 90 the square board is edge-on to the camera and reads as a
  slightly-rotated rectangle with visible frame depth (v1 look); at yaw 45 it
  projects to a symmetric diamond (v2 defect).
- `HomeBoardPreview` already ports the rest faithfully: `LEVELS[2]`,
  `MENU_VIEW_OFFSET_Y_RATIO = 0.11`, `DECOR_FRAME_ZOOM = 1.42`, 2.6s idle — all
  match v1 `App.showMenuDecor`/`tickMenuDecor` (`App.ts:195,209,212`).
- **Because the preview owns a dedicated Stage, setting menu yaw here does NOT
  touch gameplay camera** — clean, scoped fix.
- Aspect-awareness: `Stage.resize()` already fits by width in portrait and
  applies `viewOffsetYRatio`. Must be screenshot-verified at BOTH iPhone
  (390×844) and Pixel-tall (390×866+) — do not tune to one viewport.

### Defect 2 — saga chain density (game-side tokens, no kit edit)
Saga node size / gap / rail are driven by CSS custom props in
`games/marble_run/design/tokens.css` (lines 43–60), consumed by the kit
`SagaMap`. Current values:
- `--fab-levelmap-node-size: 56px`, `--fab-levelmap-node-current-size: 100px`,
  `--fab-levelmap-node-gap: 20px`.
- Rail colors: `--fab-levelmap-line-top/-mid/-bottom/-glow` (wooden tan already
  set). Verify the rail actually renders wooden vs the gray default seen in the
  v2 capture — the gray line suggests the kit path element may not be reading
  these vars in the home mount, or is overridden.
- **Tune node-size up and gap tighter to match v1 medallion-to-screen-width
  proportion** from `refs/home-fresh.png`. Values are game-side only — respects
  the scope fence.

### Defect 3 — composition
- LEVEL button: `.marble-level-button` / `.home-shell` layout in
  `src/ui/styles.css` (home-shell padding `0 13px`, action button full-width).
  Inset the button horizontally to match v1 (v1 `.btn` is `min(...)`-width, not
  full-bleed).
- Sun node above button + vertical balance falls out of the board-preview
  vertical room (`marble-home-board-preview-slot` spacer, `HomeScene.ts:258`)
  and saga gap tuning. Adjust the slot reserve / saga spacing so the sun sits
  proudly above an inset button per ref.

### Defect 4 — ambient confetti + bubble density
- v1 spawns 8 `.ambient-sprinkle` pieces on the menu (`src/ui/dom.ts:116,190`):
  6×12px rounded colored dashes (`#ff4d6d #38a3ff #44d164 #ffcc1f #b266ff`),
  opacity ~0.68, `sprinkle-fall` linear-infinite over 9–17s with negative delay
  (style.css:1697, 1953). v2 has **no** such layer on the home.
- Port the sprinkle layer into the game-owned home (e.g. spawned by `HomeScene`
  into the `#hud-overlay.home-mode` layer or the home-shell) with v1's counts,
  colors, sizes, timings — game-side CSS in `src/ui/styles.css`, no kit edit.
- Bubble texture: v2 uses `marble-shadow-tile.png` at
  `#hud-overlay.home-mode::before` (opacity 0.28, 320px tile). Compare density
  against v1 and bump tile scale/opacity if the field reads thinner than ref.

## Plan of work (implementation stage)

1. **Preview camera (defect 1):** In `HomeBoardPreview` constructor, set the
   menu yaw to v1's 90° via the existing `Stage.setDimetricCamera(groundAngle, 90)`
   seam (mirror v1 `DEFAULT_DEBUG_TUNING`). Do not change the shared Stage
   default (gameplay must stay 45°). Screenshot-verify diamond→3D at both
   viewports.
2. **Saga density (defect 2):** Tune `tokens.css` node-size / current-size / gap
   and confirm rail vars are honored in the home mount; fix the gray-rail
   regression if the path element isn't reading them.
3. **Composition (defect 3):** Inset `.marble-level-button`, rebalance the
   board-preview slot reserve + saga spacing so sun sits above an inset button.
4. **Confetti + bubbles (defect 4):** Port v1 ambient-sprinkle layer game-side;
   bump bubble tile density if thin.
5. Regression-sweep: gameplay camera unchanged (still 45° diamond in level),
   settings/pause overlays unaffected, coin pill + gear + banner intact.

## Verification method (headless-first, per card Method)

- Playwright screenshots at BOTH 390×844 (iPhone) and 390×866+ (tall/Pixel
  aspect) after EACH change, diffed against `refs/home-fresh.png`. State exact
  evidence paths in the handoff. Do not blind-tune.
- Hash every capture set (shasum) to avoid duplicate-frame false-positives.
- `npm run typecheck && npm run test && npm run lint` (or repo equivalents) green
  before handoff.

## Scope / constraints

- `games/marble_run/**` only. No `packages/ui` edits — all saga/rail styling via
  game-side tokens/CSS. No PRs (conductor merges). Camera fix is isolated to the
  menu's dedicated Stage instance.

## Open questions / risks

- The v2 capture's gray saga rail despite tan tokens being set — needs a live
  check of whether the kit path element reads `--fab-levelmap-line-*` in the home
  mount. If it does not without a kit change, escalate (do NOT edit packages/ui);
  a game-side override selector may suffice.
- v1's "slight roll" in `home-fresh.png` beyond yaw=90 may come from board
  geometry / ground angle; confirm yaw=90 alone reproduces the ref before adding
  any roll.
