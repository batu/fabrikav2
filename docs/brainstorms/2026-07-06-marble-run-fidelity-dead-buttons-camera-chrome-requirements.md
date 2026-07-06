---
title: "marble_run fidelity — dead menu buttons (P1), board camera (P1), menu/HUD chrome-to-reference (P2)"
date: 2026-07-06
trello: https://trello.com/c/6QcUojYp
card: 6QcUojYp
stage: brainstormed
depends_on: xhVERsUf
status: requirements-locked
---

# marble_run fidelity — requirements

Grounded read of the v2 port (this worktree) against the v1 seed
(`/Users/base/dev/appletolye/fabrika/games/marble_run/sugar3d`, READ-ONLY) and
the authoritative Android reference captures
(`games/marble_run/refs/captures/android-basegamelab/`, Batu-confirmed via
`dumpsys topResumedActivity`). All file:line references below were verified in
the tree, not trusted from the card.

Source of truth for the deltas:
`games/marble_run/evidence/2026-07-06-v1v2-fidelity/FINDINGS.md` (6 committed
captures) + the three conductor comments on the card (reference-package
corrections: the authoritative package is **com.basegamelab.marblerun**, which
matches the v1-web build closely — discard the earlier `com.utolye.marblerun.v5`
"SUGAR POP 3D / brown banner" frame).

## 0. Constraints (hard)

- **Gameplay logic untouched.** No edits to solve/step/scoring/level logic.
- **v1 is READ-ONLY.** Never write to `fabrika/games/marble_run/sugar3d`.
- Fidelity changes flow through `design/` (tokens/theme) + `packages/ui`
  components + shell composition **wherever possible**. This is the
  architecture bet: if a fidelity item CANNOT be expressed via tokens/components
  and forces a bespoke free-canvas hack, that is a **P1 SURPRISE to report** —
  it means the reskin surface has a gap. Name it explicitly in the plan.
- ONE Trello column of work; twf handoff between stages.

## 1. What this card ships (scope, priority order)

### P1a — Menu pointer-interception (dead buttons)

**Symptom (FINDINGS #1):** a real Playwright click on Play/menu buttons times
out / does nothing; `el.click()` in JS works. Reproduced on-device by Batu. The
existing e2e suite missed it because it drives `window.__MARBLE_RUN_HARNESS__`
(`startLevel(id)` etc., `games/marble_run/tests/e2e/play.spec.ts`) instead of
clicking real DOM buttons.

**Prime suspect (found during investigation — to be confirmed, not assumed):**
- `games/marble_run/index.html` has `#ui { position:fixed; inset:0 }` with rule
  `#ui > * { pointer-events: auto }` — **id-selector specificity (1,0,0)**.
- `packages/ui/src/ui.css:334-340` `.fab-toaster { pointer-events:none;
  position:absolute; inset:0; z-index:10 }` (class specificity 0,1,0).
- The toaster is mounted as a **direct child of `#ui`** (`App.ts:92
  mountToaster({ mountInto: this.uiRoot })`). The `#ui > *` rule therefore
  **overrides** the toaster's `pointer-events:none`, turning it into a
  full-bleed `pointer-events:auto` layer at `z-index:10` painting above
  `.fab-home-menu` (no z-index) and swallowing every menu/saga click.
- The `#scene` canvas is NOT the culprit: `GameController.ts:244` early-returns
  its pointer handler when `mode !== 'level'`.

**Requirement:**
1. Identify the intercepting layer empirically (real-click repro first, then
   confirm which element receives the event — e.g. `document.elementFromPoint`
   at the button center). Do not assume; the toaster is the lead, not the
   verdict. Any other always-mounted full-bleed `#ui` child (e.g.
   `.fab-economy-layer` ui.css:453) is a candidate under the same specificity
   trap.
2. Fix at the **stylesheet/composition** level, not with a per-button hack. The
   correct fix keeps decorative/notification overlays click-transparent while
   interactive children stay clickable — likely tightening the `#ui > *`
   blanket rule (or giving the toaster/overlays an explicit
   `pointer-events:none` that the cascade respects, and their toasts
   `pointer-events:auto`). This is a `packages/ui` + shell CSS fix → aligns
   with the architecture bet.
3. **Add a REAL-CLICK e2e test for every menu button** — Play/`LEVEL N`, gear
   (settings), coin/shop if present, and each reachable saga node. NO harness
   shortcuts (`__MARBLE_RUN_HARNESS__`), NO `force:true`, NO `dispatchEvent`.
   Use Playwright `locator.click()` with default actionability so an
   intercepting layer makes the test fail. This class of bug must never pass
   silently again — the test is the regression guarantee.

**Acceptance:** real-click e2e green; clicking Play on a fresh menu actually
starts the level in a real browser.

### P1b — Board camera in-level

**Symptom (FINDINGS #2):** v1 = near-top-down straight board filling ~60% width;
v2 shows a small 45°-rotated diamond floating mid-screen.

**Surprise found during investigation (must be reconciled before implementing):**
the v2 in-level camera code **already matches v1 1:1**:
- `games/marble_run/src/game/Stage.ts` is byte-for-byte the same camera logic as
  v1 `sugar3d/src/three/Stage.ts` (ground angle `60°`, yaw `45`, fov `30/32`,
  `BOARD_SCREEN_WIDTH_FILL = 0.9`).
- `GameController.startLevel()` (`GameController.ts:149-176`) sets
  `setViewOffsetYRatio(0.035)` + `frameBoard(w, d)` — identical to v1
  `App.ts:147/162`.
- Constant `GAMEPLAY_CAMERA_GROUND_ANGLE_DEG = 60` matches v1
  `Constants.ts:11`.

**Therefore P1b is NOT "port the camera params" (they are ported).** The visible
diamond regression is upstream of framing. Requirement is to **root-cause the
actual divergence**, candidates:
- board **world sizing** — `BoardScene.boardSize()` / decor-vs-level scale feeding
  `frameBoard(w, d)` with wrong dimensions;
- the pointer-interception overlay / a stale menu camera state
  (`showMenuScene` uses `frameBoard(w*1.42, d*1.42)`, offset `0.11`) not being
  reset on transition to play;
- v1's debug camera-mode switcher (`sugar3d App.ts:417-423`) that GameController
  never calls, leaving the camera in a different mode than intended.

Fix so the in-level board renders near-top-down, straight, ~60% width, matching
v1. **Kill the 45° floating diamond.** Verify with a side-by-side capture
(v1 dev server: `npx vite --port 5211` in the sugar3d dir; v2 on 5210).

**Acceptance:** side-by-side capture shows v2 board orientation/scale matching
v1.

### P2a — Menu structure to reference

Reference (`refs/captures/android-basegamelab/menu.png`): wooden banner, teal
**coin pill (top-left) + gear (top-right)** bar, large near-straight board,
centered zigzag **saga chain with sun medallion** and slight alternating
offsets, ONE chunky green **`LEVEL N`** candy button.

Current v2 (`App.ts:163-180 mountMenu()`): banner + saga rail + an **invented
Play / Levels / Shop / Settings button stack** (`App.ts:177`), **no top bar at
all**, saga nodes scattered full-width overlapping the board
(`packages/ui/src/SagaMap.ts`).

**Requirements:**
- Collapse the action stack to a **single primary `LEVEL N` button** (green
  candy style) that starts the current level.
- **Remove the invented `Levels` screen** ("Levels" is not a concept in any of
  our games — Batu). Keep `SagaMap` as the level picker per v1; do not ship a
  separate Levels page. (Shop/Settings reachable via top-bar chrome, not the
  primary stack.)
- Add the **menu top bar**: coin pill (left) + gear (right), teal chrome, via
  `packages/ui` components + `design/tokens` where possible (currently MISSING
  — no component renders menu coin/gear chrome; this is a reskin-surface gap to
  fill in `ui`, not a game-local hack).

### P2b — In-level HUD chrome to reference

Reference (`level-start.png`): chunky **teal panels** — hearts panel TL, gear
TR, coin pill BL, square **HINT + cost** BR (v1 `dom.ts` look).

Current v2 (`GameController.ts:609-642 buildHud()`): hand-built `innerHTML` with
hardcoded emoji (`❤`, `🪙`), grey pills, hint pill bottom-center, inline styles
(`injectHudStyles` `GameController.ts:838-855`). **All free-canvas, zero design
tokens, zero `@fabrikav2/ui`.**

**Requirement:** re-express the HUD via `packages/ui` components +
`design/tokens` **wherever the shell can carry it**; keep free-canvas HUD
**only** where the shell genuinely cannot (and if a needed element can't be
expressed via ui/tokens, that is a P1 SURPRISE to report per §0). Match the
reference layout: hearts TL, gear TR, coin BL, square HINT+cost BR, teal panel
styling.

### P2c — Background + ambient motion

Reference: patterned purple background (marble motifs) + ambient confetti on
menu; centered saga chain with sun medallion and slight alternating offsets
below the board.

Current v2: flat CSS gradient background only (`index.html:22-31` +
`design/tokens.css:64-65`); **no repeating pattern asset**, **no confetti** (the
only "confetti" mention is a doc-comment in `ResultCard.ts:11`).

**Requirements:**
- Add a repeating **marble-motif background pattern** (via tokens/theme asset,
  not a one-off).
- Add **menu ambient confetti** (lightweight; menu only).
- Reposition saga nodes onto a **centered chain with slight alternating
  offsets** below the board (fixes the full-width scatter overlap in
  `SagaMap.ts`).

### P2 (added by conductor, comment #3) — Settings as modal

Reference (`settings.png`): settings is a **MODAL over the dimmed menu** — blue
card, orange ribbon title, X close, Music/SFX/Haptics green toggles, green
`CLOSE` button, `RESET PROGRESS` link. v2 built a **full `SettingsPage`**
(`packages/ui/src/SettingsPage.ts` → `mountPageShell`, a slide-up full page).

**Requirement:** re-compose settings as a **`ModalShell` variant**
(`packages/ui/src/ModalShell.ts` already exists) matching the reference
structure. **Compose, don't rebuild** — reuse existing `ToggleRow`, tokens, and
copy; swap the shell from `PageShell` to `ModalShell`.

## 2. Out of scope

- Any gameplay/solve/scoring/level-content change.
- Win / fail / level-complete reward surfaces (reference states PENDING capture;
  `refs/.../README.md`) — do not guess their fidelity now.
- Editing v1 sugar3d.

## 3. Evidence / re-capture obligation

After fixes, **re-capture the 6 comparison shots** (v1 5211 vs v2 5210, 390x844)
into `games/marble_run/evidence/` as a **before/after grid**. The camera fix in
particular is only "done" with a side-by-side that visibly matches v1.

## 4. Open questions for the plan stage

1. **P1b root cause is unknown** — camera params match v1, so the diamond comes
   from board world-sizing, a stale menu-camera transition, or an uncalled
   camera-mode switch. The plan must include a root-cause step (capture + DOM/
   three inspection) BEFORE proposing the fix. This is the highest-risk item.
2. **Reskin-surface gaps** — menu top-bar chrome and the teal HUD panels do not
   exist as `ui` components today. Plan must decide, per element: extend
   `packages/ui` (preferred, matches the bet) vs. free-canvas fallback (only
   when the shell can't carry it), and **flag any forced free-canvas fallback as
   a P1 SURPRISE**.
3. **Pointer fix blast radius** — tightening `#ui > * { pointer-events:auto }`
   touches shared `packages/ui`/shell CSS used by every game. Confirm no other
   game relies on the blanket rule before changing it; the real-click e2e is the
   guard for marble_run, but cross-game regression is a review concern.

## 5. Verification (from the card AC; commands confirmed present)

```bash
npm run test:unit --workspace=games/marble_run   # vitest run
npx playwright test --config games/marble_run/playwright.config.ts
npm run audit                                     # node tools/audit/src/cli.js
```

Full gate green + real-click e2e green + camera side-by-side match + menu/HUD
structurally matching the android-basegamelab reference = done.
