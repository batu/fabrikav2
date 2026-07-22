---
title: "MRV2-20 — Menu quality pass (font, turning board, saga align/z-order/current-node color, LEVEL button shape, app icon)"
type: fix
status: planned
origin: card description (MRV2-20 f5VDE3ps — Batu escalation defect list, no brainstorm doc; stills-based judging missed these)
trello: card f5VDE3ps (MRV2-20) — board twf pipeline, column planned
date: 2026-07-23
scope_fence: games/marble_run/** (+ named native-resources) only — no packages/ui edits, no PRs
---

# MRV2-20 — Menu quality pass

## Problem

Batu's home-menu escalation. Seven verbatim defects vs the v1 canonical. This is
a follow-up to MRV2-18 (aesthetic parity) — that pass fixed preview camera, chain
density, composition, confetti. These seven are the residual, sharper defects that
stills-based judging missed. The MANDATORY METHOD is side-by-side v1/v2 at 390×844,
v1 evidence captured FIRST for every item (screenshot; short video/timed sequence
for anything animated), then reproduced and re-captured in v2. No fix ships without
its v1 reference captured first.

## Canonical source (ground truth)

v1 Sugar3D: `/Users/base/dev/appletolye/fabrika/games/marble_run/sugar3d`
(`docs/asset-manifest.json` `v1Root`). Port params verbatim — do not approximate.
v1 dev server: `cd <v1Root> && npm run dev`. v2 dev server:
`cd games/marble_run && npm run dev`. Run both, capture at 390×844.

## Root-cause findings (verified against v1 + v2 source)

### Item 1 — THE FONT IS DIFFERENT (global) — ROOT CAUSE FOUND
The woff2 **file is byte-identical** across v1 and v2 —
`shasum` = `a7419d2e8b92cbc5f89c3c03771f45c4f632964c` for
`games/marble_run/public/fonts/FredokaOne.woff2`,
`public/v1/ui/fonts/FredokaOne.woff2`, and v1
`src/ui/assets/fonts/FredokaOne.woff2`. So this is NOT a missing-file / failed-load
bug — it is a **family-application** bug.
- v1 (`src/ui/style.css:25-26,81`) defines
  `--marble-font-body: 'Marble Display', system-ui, sans-serif` where
  `'Marble Display'` **is** the FredokaOne woff2 (`@font-face` line 3-8), and applies
  `font-family: var(--marble-font-body)` to the base body. **Every** text surface
  inherits FredokaOne unless it opts into `--vida-font-*`.
- v2 (`src/ui/styles.css:16`) sets the base `#hud-overlay` to
  `font-family: 'Nunito', sans-serif`. **There is no `@font-face` for `'Nunito'`** in
  v2 → base text silently falls back to the system sans-serif. v2 only opts specific
  surfaces into `'FredokaOne'` (styles.css:3752, 4056, 4088, 4204, 4496, 4525). So
  most menu/HUD text renders in a system font, not the chunky display font v1 uses
  everywhere.
- **Fix direction:** mirror v1's model — make FredokaOne the inherited base family
  (replace the unloaded `'Nunito'` base with `'FredokaOne', system-ui, sans-serif`,
  or register a real `'Nunito'` face only if v1 actually uses Nunito somewhere —
  v1 does NOT). Then audit every text surface at the base and confirm FredokaOne
  applies. This is global: check header, banner, coin pill, LEVEL button label,
  saga node numbers, settings, pause, HUD numerals against v1 surface-by-surface.
- Risk: `LilitaOne`/`Vida` display faces (styles.css:4325) are legitimately a
  different family in v1 (`--vida-font-level`); do not flatten those to FredokaOne.

### Item 2 — MENU BOARD ISN'T TURNING — ROOT CAUSE FOUND
- v1 rotates the decor board every frame on menu screens:
  `App.ts:626-627` → `if (this.decorBoard) this.decorBoard.root.rotation.y += dt * 0.12;`
  (0.12 rad/s slow showcase spin), inside the same tick that calls `tickMenuDecor`.
- v2 `HomeBoardPreview.loop()` (`src/menu/HomeBoardPreview.ts:107-116`) calls
  `this.board?.tick(dt)` and `this.tickDecor(dt)` (idle marbles only) but **never
  applies the showcase y-rotation to the board root**. The board renders static.
- **Fix direction:** in `loop()` (or `tickDecor`), rotate the preview board's root
  by `dt * 0.12` rad/s, matching v1's `App.ts:627`. Confirm the rotation seam on the
  v2 board object (root/group) and that it composes with the existing idle-marble
  tick and yaw=90 camera (from MRV2-18) without fighting the fit. Capture v1 as a
  short video/timed sequence FIRST to confirm rate/axis, then match.

### Item 3 — SAGA NOT CENTER-ALIGNED
- v1's chain is centered on the screen midline; v2 drifts. Layout is game-side:
  the saga mount / home-shell in `src/ui/styles.css` and `src/menu/homeMenu.ts`
  (`#home-saga-map` container). Investigate the mount's horizontal centering
  (margin/left/transform) at the home; the drift likely comes from an off-center
  container or an asymmetric board-preview slot pushing the rail.
- **Fix direction:** center the saga mount on the viewport midline (v1 parity).
  Capture v1 with a vertical center guide overlaid FIRST; measure v2 offset; correct.

### Item 4 — SAGA NOT BEHIND THE BOARD (z-order)
- v1: the chain/rail passes BEHIND the board preview; v2 layers it in front.
  Stacking is game-side (`src/ui/styles.css` z-index on the board-preview slot vs
  the saga mount; `HomeScene`/`homeMenu` DOM order).
- **Fix direction:** raise the board-preview slot above the saga rail (z-index or
  DOM order) so the rail tucks behind the board, matching v1. Verify no new overlap
  of the LEVEL button / sun node with the board.

### Item 5 — CURRENT-LEVEL NODE IS WHITE — ROOT CAUSE FOUND
- `games/marble_run/design/tokens.css:53` → `--fab-levelmap-current-color: #ffffff;`.
  The current-node art is already the gold sun webp
  (`tokens.css:42 --fab-levelmap-art-current: url('/v1/ui/level-node-current.webp')`),
  so the **white comes from the current-node number/label color token**, not the art.
- v1's current node = gold sun with a **brown** number, no white fill
  (v1 `src/ui/style.css:1053-1091` `.menu-saga-mount .fab-levelmap-node.current`,
  `--fab-levelmap-node-current-*`). Capture v1's current node FIRST for the exact
  brown.
- **Fix direction:** set `--fab-levelmap-current-color` to v1's brown numeral color
  (read the exact value from v1 style.css current-node block). Confirm the number is
  legible on the gold sun and no white ring/fill remains.

### Item 6 — LEVEL BUTTON SHAPE differs
- v2 renders the LEVEL CTA as a **sprite image**:
  `src/menu/homeMenu.ts:114-115` `className: 'marble-level-button'`,
  `spriteImage: assetUrls.levelButton` where
  `design/theme.ts:21 levelButton: '/v1/ui/vida/End/Win/Button_Green.png'` — i.e. the
  **Win-screen** green button art. There is currently **no `.marble-level-button` CSS
  in the game** (grep of `src/` finds only the className usage), so geometry is the
  kit default action-button box wrapping the Win-screen sprite.
- v1's menu play button is a different surface: v1 `.btn` (`style.css:185-267`) is a
  **pill** (`border-radius: var(--sugar-radius-pill)`) with a gloss `::after`
  (line 211), plus `.orange`/`.wood` variants — NOT the flat Win-screen sprite. The
  corner radius / height / gloss proportions Batu flags trace to this.
- **Fix direction:** capture v1's actual home LEVEL button FIRST (art + geometry),
  then match in v2 — either point `assetUrls.levelButton` at v1's real menu button
  art if one exists, or add game-side `.marble-level-button` CSS (radius/height/gloss)
  that reproduces v1's pill proportions. Scope fence: game-side CSS/asset only, no
  `packages/ui` edit — the kit passes the className/sprite through
  (`packages/ui/src/HomeMenu.ts:96-124`), so all styling lands in the game.

### Item 7 — MARBLE RUN APP ICON NOT SET — assets present, wiring to verify
- The icon assets are **already ported** into native-resources (MRV2-3):
  - iOS: `native-resources/ios/App/App/Assets.xcassets/AppIcon.appiconset/` holds
    `AppIcon-512@2x.png` (~1.0 MB marble icon) + `Contents.json` (single-size format).
  - Android: `native-resources/android-res/app/src/main/res/mipmap-*/` holds
    `ic_launcher.png`, `ic_launcher_foreground.png`, `ic_launcher_round.png`
    (real marble art, e.g. xxxhdpi ic_launcher.png ~58 KB, foreground ~244 KB).
- So the defect ("installs with placeholder icon") is a **wiring/consumption** gap:
  the generated `ios/`/`android/` Capacitor projects (build artifacts, never
  committed — see `native-resources/README.md`) are not picking up these overlays,
  OR the `cap add`/`cap sync` + native-shell overlay step
  (`tools/native-shell/src/native-shell.mjs:354` reads `native-resources/ios`) is not
  copying the AppIcon/mipmaps into the platform project.
- **Fix direction (investigate then wire):** confirm `capacitor.config.ts` +
  `npm run ios:sync` / android sync actually copy `AppIcon.appiconset` and the
  `mipmap-*` sets into the generated projects so the installed app shows the Marble
  Run icon on BOTH platforms. If the overlay copy is missing a step, add it to the
  committed sync script (game-side / named native-resources only). Verify by building
  and reading the icon on a booted simulator/emulator home screen (not just exit
  codes) — device-first, per project policy.

## Plan of work (implementation stage)

Capture v1 evidence FIRST for each item, then fix, then capture v2. Suggested order
(cheapest / highest-signal first):

1. **Font (item 1)** — repoint base family to FredokaOne; audit every text surface
   vs v1. Global, touches the most pixels.
2. **Current-node color (item 5)** — one token (`--fab-levelmap-current-color`) →
   v1 brown; confirm gold-sun art + legible brown number.
3. **Turning board (item 2)** — add `dt * 0.12` y-rotation to the preview board root
   in `HomeBoardPreview.loop()`; video-verify rate/axis vs v1.
4. **Saga center + z-order (items 3, 4)** — center the saga mount on the midline and
   tuck the rail behind the board-preview slot; game-side CSS only.
5. **LEVEL button shape (item 6)** — capture v1's menu button; match art/geometry via
   `assetUrls.levelButton` and/or game-side `.marble-level-button` CSS.
6. **App icon (item 7)** — verify + wire native-resources icon overlays into the
   generated ios/android projects; confirm installed-app icon on sim/emulator.
7. **Regression sweep** — after each change re-check the 2–3 neighboring behaviors:
   gameplay HUD font unchanged where v1 uses Vida faces, gameplay camera still 45°
   diamond (menu preview owns its own Stage/yaw), settings/pause overlays, coin pill
   + gear + banner, MRV2-18 confetti/bubble layer intact.

## Verification method (per card MANDATORY METHOD)

- Run v1 and v2 side-by-side at 390×844. For EVERY item: capture v1 evidence FIRST
  (screenshot; short playwright video or timed screenshot sequence for the turning
  board and any motion), reproduce in v2, capture matching v2 evidence.
- Handoff lists per-item **v1-evidence-path vs v2-evidence-path**.
- Hash every capture set (`shasum`) — a duplicated screenshot passes visual review
  because the duplicate is a valid image (memory: hash-device-evidence-frames).
- App icon (item 7) verified on a booted simulator/emulator home screen, not build
  exit codes.
- `npm run typecheck && npm run test && npm run lint` (repo equivalents) green before
  handoff.
- Store builds/DerivedData/captures under `$TWF_OUT_DIR`, not the source worktree.

## Scope / constraints

- `games/marble_run/**` and the named `native-resources` only. **No `packages/ui`
  edits** — saga/rail/button styling flows through game-side tokens/CSS and the
  className/sprite the kit already passes through. No PRs (conductor merges).
- The menu board preview owns a dedicated `Stage` instance, so the turning-board and
  any camera work is isolated from the gameplay camera.

## Open questions / risks

- Item 1: confirm v1 never actually loads a real `'Nunito'` face anywhere before
  deleting the fallback — if a surface intends Nunito, register it; do not blindly
  flatten. Also do NOT flatten the `Vida`/`LilitaOne` display faces to FredokaOne.
- Item 6: v1's home LEVEL button art may be a CSS pill (`.btn`) rather than a sprite
  file — there may be no single "menu button PNG" to point at; matching may require
  reproducing the pill+gloss geometry in game CSS. Confirm from the v1 capture before
  choosing sprite-swap vs CSS.
- Item 7: the generated ios/android projects are not in this sparse checkout and are
  never committed; verifying the icon requires a local `cap add/sync` + build. If the
  overlay step is missing entirely, the fix lands in the committed sync script — flag
  if it would require more than a wiring tweak.
