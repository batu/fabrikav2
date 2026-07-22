---
title: "fix: MRV2-11 device parity wave 5 (modal centering, pause modal mount, settings close variant, preview camera, win composition)"
date: 2026-07-22
type: fix
origin: trello-card-CBswpJud (card description; no brainstorm doc)
trello: https://trello.com/c/CBswpJud
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-11 device parity wave 5

## Summary

Round-4 judge: gameplay states CLEAN. Remaining defects are modals (settings/win/pause) and the home/map board preview. Reference truth (host-local): `/private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/scratchpad/{refs,v2caps4,judge4}/<state>.png`.

Code-level ground truth established during planning (each verified by reading the current tree):

1. **Modal geometry is container-relative, and every modal mounts into a different container.** The kit backdrop is `position:absolute; inset:0` (`packages/ui/src/ui.css:228-240`) — it fills its **mount container**, never the viewport. Home settings mounts into `#hud-overlay` (`HomeScene.ts:269-273`), pause settings into `#game-container` (`GameScene.ts:286-305`), win into `#hud-overlay` (`LevelCompleteOverlay.ts:204`), and a legacy path in `HUD.ts:212` into its own `overlay`. `v2caps4/settings.png` shows the card rendered ~2x normal scale, top-cropped, with the un-dimmed home visible in the lower ~43% of the screen — i.e. on device the backdrop's containing box is NOT the visible viewport (wrong size and/or offset), and something scales the modal subtree relative to the home shell. The exact device-side mechanism (container rect vs. transform vs. Phaser-resized container) is **not yet proven** and must be observed on the real DOM before the fix is finalized (see U1). What IS certain from the code: nothing guarantees any of these three containers is a full-viewport box, and one fixed-position modal layer would make all three modals immune to their containers.
2. **Pause "backdrop only": the only structural difference from home settings is the mount container.** Same `mountSettings` code path, same assets; home works, gameplay doesn't. `#game-container` is the Phaser parent (Phaser manages its content/size during gameplay; it also carries the wave-4 `::before` bubble layer at z0 and `canvas { z-index:1 }`, `hud.css:30-58`). Mounting the pause modal into the same full-viewport modal layer as home settings removes the divergent container entirely — one fix for defects 1+2. Note `GameScene` already tears `settingsHandle` down on shutdown (`GameScene.ts:100-101, 240-241`), so the wave-4 stale-modal fix survives a mount-point change.
3. **Settings close X exists but is broken art, not a missing code path.** `mountSettings` always passes `closeButton` (`settings.ts:112`, `dataAction:'settings-x'`) and `HomeScene.openHomeSettings` forces `inGame:false`, so the menu variant IS the home path. But the game styles `.fab-modal-close` as `url(Button_Settins.png) 100%/100%` stretch with `color:transparent` and no size (`design/theme.ts:277-281`) — in `v2caps4/settings.png` it renders as a huge stretched blue ellipse at the card top, unrecognizable as an X. There is **no X sprite in the repo** (`public/v1/ui/vida/**` has no close/X asset). Ref `refs/settings.png`: a small blue rounded SQUARE with a white × glyph docked at the ribbon's top-right. That is achievable with the existing blue-square sprite + a rendered × glyph.
4. **Preview camera: the port is faithful; the CANVAS GEOMETRY is not.** `HomeBoardPreview.ts` matches v1 `App.showMenuDecor` exactly (LEVELS[2], `setViewOffsetYRatio(0.11)`, `frameBoard(w*1.42, d*1.42)`; `Stage.ts` and `BoardScene.ts` diff clean vs `fabrika/games/marble_run/sugar3d/src/three/*` except the v2 dispose seam). The difference is where it renders: **v1 draws the decor board on the app's full-viewport stage canvas behind the DOM menu**; v2 confines it to a small square DOM slot (`.marble-home-board-preview-slot`: `min(66vw,300px)`, 1:1, max 264px — `design/theme.ts:198-209`). `Stage.frameBoard` fits the board to the canvas aspect, so a small square canvas yields a small, weak-perspective board with the frame shrunk to nothing. Ref `refs/home-fresh.png`: the board spans most of the screen width, clearly tilted, thick wooden frame. Fix = give the preview a full-bleed (viewport-sized, absolutely positioned behind the home DOM) canvas like v1, not a bigger slot.
5. **Win composition: current DOM puts everything inside the card; ref splits it into three screen-level pieces.** Ref `refs/win.png` (top→bottom): blue coin pill at the SCREEN top-right (safe-area docked); green LEVEL 1 / COMPLETED ribbon overlapping the card's top; compact blue card (crown, REWARD, +25); a **standalone** green Next pill far below the card. Behind all of it: the **darkened live board** (wooden frame visible through the dim). Current code: coin pill appended to `.fab-modal-card` (`LevelCompleteOverlay.ts:220`), Next button inside `fab-modal-actions` in the card, and the wave-4 scrim is an OPAQUE purple gradient (`design/theme.ts:317-320`) that hides the board — three concrete deltas to unwind.

Scope fence: `games/marble_run/**` only (plus this plan doc). **No `packages/ui` edits** — if ModalShell cannot center correctly via its supported surface (mount container choice + game CSS overrides + theme tokens), report in SURPRISES; do not fork the kit. No PRs; the conductor merges and judges device captures. Worker verification: typecheck + unit + eslint.

---

## Key Technical Decisions

- **KTD1: One fixed full-viewport modal layer; every modal mounts there.** Create (or reuse) a single game-owned modal root — a `position:fixed; inset:0` element directly under `<body>` (sibling of `#game-container`), z-order above `#hud-overlay` (z2) and `#scene-transition-cover` (z20). Mount home settings, pause settings, finale, and the win/fail result cards into it. Belt-and-braces game CSS (supported surface, no kit edit): `.marble-ui .fab-modal-backdrop { position: fixed; inset: 0; }` plus safe-area-aware padding (`--fab-modal-backdrop-padding`) and `.fab-modal-card { max-height: calc(100dvh - insets); overflow-y: auto; }` so a tall card can never be top-cropped (flex-center crops the top edge irrecoverably when content overflows). This single change is expected to heal defects 1 and 2 together.
- **KTD2: Prove the device mechanism before trusting the fix.** Before restructuring, extend the existing TestHarness snapshot with a `modalGeometry` probe (backdrop/card/mount-container `getBoundingClientRect` + `visualViewport` size + any computed transform up the chain), so the round-5 device run *shows* what was wrong and that it is gone. Cheap, tool-shaped, removable later.
- **KTD3: Blue X = blue square sprite + rendered glyph, not a phantom asset.** No X art exists in-repo; do not invent/generate one. Style `.fab-modal-close` as a fixed ~52-56px square (the `Button_Settins.png` blue square already reads as the ref's blue tile), docked top-right overlapping the ribbon (kit already positions it absolutely), and render a white bold `×` text glyph (drop `color:transparent`, set the label/glyph explicitly). Menu variant keeps Close + X; in-game variant keeps Restart/Home (ref parity — v1 has no X in-game… if judge4 says otherwise the in-game variant keeps whatever wave-4 shipped).
- **KTD4: Preview parity by reproducing v1's canvas geometry, not by inflating the slot.** Render the `HomeBoardPreview` canvas full-bleed behind the home DOM (absolute, `inset:0`, z below the home shell content, `pointer-events:none`), keep `setViewOffsetYRatio(0.11)` + `frameBoard(×1.42)` untouched — at viewport aspect this reproduces v1's large tilted framed board by construction. The old DOM slot collapses to a spacer that reserves vertical room between banner and saga chain (so layout/flow stays as-is). Node overlaps (sun node 1 vs LEVEL button on home; node 106 vs button on level map) are flow/z fixes in `design/theme.ts` (bottom padding reserve + `z-index` of the saga nodes above `.fab-home-menu-actions` where the ref demands it).
- **KTD5: Win composition restructured to match the ref's three screen-level pieces.** Coin pill moves from the card to the backdrop (screen top-right, safe-area inset); Next moves out of the card into a standalone action row well below the card (backdrop-level flex column: ribbon+card group, spacer, Next); scrim reverts from opaque purple to a translucent purple dim so the darkened board shows through (the wave-4 opaqueness overshot — GameScene no longer needs hiding because the board behind IS the ref composition). Keep single-source COMPLETED (ribbon sprite only) and the +25 reward pinning from wave 4.

---

## Implementation Units

### U1. Device-truth probe: modal geometry telemetry

**Goal:** The round-5 device run can prove what made modals top-pin/crop/scale (defects 1-2) and that the fix removed it.

**Dependencies:** none.

**Files:** `games/marble_run/src/testing/TestHarness.ts` (snapshot payload), possibly `packages/testkit` READ-ONLY.

**Approach:** Add a `modalGeometry()` section to the harness snapshot: for the open `.fab-modal-backdrop`/`.fab-modal-card` and their mount container — `getBoundingClientRect`, computed `position/transform/zoom/font-size`, `window.innerWidth/Height`, `visualViewport.width/height/offsetTop`. Pure read, returns data, no flow control.

**Test scenarios:** unit: snapshot includes the section when a modal is open, omits it otherwise (jsdom).

**Verification:** typecheck + unit; the payload itself is judged from device logs by the conductor.

### U2. One fixed modal layer: settings (home + pause), finale, win/fail

**Goal:** Settings, pause and win render as a centered card over a full-screen dim on device (defects 1 + 2).

**Dependencies:** U1 (probe in place first so before/after is observable).

**Files:** `games/marble_run/index.html` (modal root element), `games/marble_run/src/scenes/HomeScene.ts`, `games/marble_run/src/scenes/GameScene.ts`, `games/marble_run/src/ui/HUD.ts` (legacy path), `games/marble_run/src/ui/LevelCompleteOverlay.ts`, `games/marble_run/src/ui/LevelFailedOverlay.ts`, `games/marble_run/src/menu/finale.ts` callers, `games/marble_run/design/theme.ts` (backdrop fixed/inset + card max-height/overflow + safe-area padding), unit tests touching mount points (`tests/unit/shell-settings.test.ts`, `shell-results.test.ts`).

**Approach:** Per KTD1. Add `#modal-root` (fixed, inset 0, `z-index` above 20, `pointer-events:none`; the kit backdrop re-enables `pointer-events:auto`). Point every `mountInto` at it. Keep `completion-mode` class behavior working (it currently lives on `#hud-overlay` — move the hook to the modal root or key the scrim CSS off the overlay id instead). Preserve GameScene teardown + `dismissAnyOpenSettingsModal` belt-and-braces. Audit `OverlayVisibility.ts`/`tourstate` predicates for assumptions about where modals live (`TestHarness.ts:122-135` queries by `.fab-modal-card` globally — should survive).

**Test scenarios:** settings/win/fail/finale mount into `#modal-root`; backdrop computed class list unchanged; predicates (`settingsVariant`, win overlay detection) still resolve; dismissal restores `pointer-events:none` root.

**Verification:** typecheck + unit + eslint; centered-on-device is conductor-judged (`refs/settings.png`, `refs/win.png`, pause).

### U3. Settings close X (menu variant)

**Goal:** Home settings shows the small blue square X at the ribbon top-right; Close pill remains (defect 3, ref `refs/settings.png`).

**Dependencies:** U2 (same files; do together).

**Files:** `games/marble_run/src/menu/settings.ts` (close button label/glyph), `games/marble_run/design/theme.ts` (`.fab-modal-close` sizing/position), `tests/unit/shell-settings.test.ts`.

**Approach:** Per KTD3: fixed square size (~52px), blue square sprite background, white bold `×` glyph (remove `color:transparent`; supply the glyph via the `label` or a styled pseudo-element), docked top-right overlapping the ribbon per ref. Verify the kit's `--fab-modal-close-inset` token positions it; override inset via game CSS if needed.

**Test scenarios:** menu variant renders `[data-fab-action="settings-x"]` with visible glyph text; in-game variant unchanged (Restart/Home, no behavioral change).

**Verification:** typecheck + unit; visual is conductor-judged.

### U4. Home/level-map board preview: full-bleed v1 canvas geometry + node clearance

**Goal:** Large tilted framed board behind the home/map DOM exactly as v1 renders it; sun node 1 clears the LEVEL button on home; node 106 sits above the button on the level map (defect 4, ref `refs/home-fresh.png`).

**Dependencies:** none (parallel to U2/U3).

**Files:** `games/marble_run/src/menu/HomeBoardPreview.ts` (canvas placement only — camera/framing constants untouched), `games/marble_run/src/scenes/HomeScene.ts` (mount target), `games/marble_run/design/theme.ts` (slot→spacer, node z/padding), `tests/unit` covering the preview mount if present.

**Approach:** Per KTD4. Canvas becomes absolute full-bleed behind the home shell (z under DOM content, `pointer-events:none`, `aria-hidden`); `Stage.resize()` then sees viewport aspect and `frameBoard(×1.42)` + `viewOffsetYRatio 0.11` reproduce v1. Keep the DOM spacer so banner→saga spacing is stable. Node clearance: home — ensure the saga column's last (current) node renders fully above `.fab-home-menu-actions` (padding reserve already exists at `theme.ts:236-246`; adjust so the CURRENT node, 100px, clears with margin and z-orders above the button only if the ref shows overlap-with-node-on-top); level map — node 106 must z-order above the button per card. Pin with a CSS assertion test where the suite already does that (see wave-3/4 tests).

**Test scenarios:** preview canvas mounts full-bleed with the expected class; dispose still removes canvas + GL; saga node z/padding rules present.

**Verification:** typecheck + unit; geometry is conductor-judged on device.

### U5. Win composition: screen-level pill / ribbon+card / standalone Next over dimmed board

**Goal:** Match `refs/win.png` composition (defect 5).

**Dependencies:** U2 (win mounts in the modal root; composition builds on that structure).

**Files:** `games/marble_run/src/ui/LevelCompleteOverlay.ts`, `games/marble_run/design/theme.ts` (scrim translucency, layout column, pill/Next placement), `tests/unit/shell-results.test.ts`.

**Approach:** Per KTD5: coin pill appended to the backdrop (not the card), absolutely docked top-right with safe-area inset; actions row moved out of the card via the kit's supported `actions` slot if it renders outside `.fab-modal-card` — if `mountResultCard` hard-places actions inside the card, place Next as a game-owned element appended to the backdrop below the card and drop the kit `actions` (check `packages/ui/src/ResultCard.ts` READ-ONLY first; if neither surface allows an outside-card action, report in SURPRISES rather than editing the kit). Scrim: translucent purple dim (board visible beneath); remove the wave-4 opaque gradient; verify GameScene's `setHudVisible(false)` still hides vida HUD chrome so only the darkened board shows.

**Test scenarios:** win overlay: coin pill is NOT inside `.fab-modal-card`; exactly one COMPLETED text source (existing test); Next exists once, outside the card; scrim rule no longer opaque.

**Verification:** typecheck + unit; composition is conductor-judged.

### U6. Close-out: full local gate

**Goal:** Green worker-level verification, honest handoff.

**Dependencies:** U1-U5.

**Approach:** `npm run typecheck`, unit suite, `npx eslint .` (scoped as the repo scripts define); no browser e2e as close-out (policy). List anything unverifiable locally (all device visuals) as remaining for the conductor's device judge.

---

## Risks / open questions

- The true device-side modal mechanism is unproven until U1 runs on-device; KTD1 is chosen precisely because it is correct regardless of which candidate (container rect, Phaser-managed container, transform/scale ancestor) is the culprit. If round-5 captures still misplace modals, the U1 probe output is the next worker's ground truth.
- `mountResultCard`'s actions slot may not support an outside-card Next; the fallback (game-owned button on the backdrop) is specified in U5 — kit fork is forbidden.
- Full-bleed preview canvas renders behind the whole home; watch GPU cost on device (v1 shipped exactly this, so accepted) and make sure `dispose()` still runs on scene exit (it does today).
- `completion-mode` scrim hook moves with the mount point; `OverlayVisibility`/drive predicates must be re-audited after U2 (called out in the unit).
