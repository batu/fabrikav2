---
title: "fix: MRV2-14 device parity wave 7 (home vertical budget, map order, modal ribbons, pause button colors, win reward stack)"
date: 2026-07-22
type: fix
origin: trello-card-x0AxRdoB (card description; no brainstorm doc)
trello: https://trello.com/c/x0AxRdoB
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-14 device parity wave 7

## Summary

Round-6 judge (refs/, v2caps6/, judge6/ under `/private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/scratchpad/`). Gameplay clean; five fine-detail defects remain. Scope fence: `games/marble_run/**` only, **no `packages/ui` edits**, no PRs.

**All five defects were root-caused during planning by reading the tree and eyeballing refs vs v2caps6.** Key facts, with kit CSS cited READ-ONLY:

1+2. **Home / level-map vertical budget & full-bleed button — one root cause, two symptoms.** The home column overflows 100dvh by ~200px, so the saga chain's tail (sun node 1 on home-fresh; nodes 106/107 on level-map) slides under/below the fixed LEVEL button. Budget at 390×844: header ≈190px + preview spacer `.marble-home-board-preview-slot` up to 264px (`design/theme.ts:198-209`) + saga rail `min-height: min(455px, 100%)` with `justify-content:center` (`packages/ui/src/ui.css:618-627` — a 4-node chain is only ~280px tall, so ~175px of dead centered padding) ≈ **905px** against an available 844−148 (button reserve, `theme.ts:264`) = **696px**. That dead band is exactly the huge empty gap between board and chain in v2caps6/home-fresh.png. The judge's "chain inverted" reading is this same overflow: DOM order is already 4→3→2→1 with the button last; node 1 is merely pushed off-screen below the fixed button. Separately, the LEVEL button is full-bleed because the kit sets `.fab-home-menu-actions { width: 100% }` (`ui.css:746-751`) and the game override makes that element `position: fixed` (`theme.ts:267-273`) — a fixed element resolves `width:100%` against the **viewport**, hence edge-to-edge. v1 ref: inset ~220px pill.
3+4. **Pause & settings modal ribbon — kit ribbon contract broken by the game card, not a kit bug.** The kit ribbon centers itself with `align-self: center` and overhangs via `margin-top: calc(-1*var(--fab-space-lg) - var(--fab-ribbon-overhang))` (`ui.css:310-321`), which assumes (a) the card is a **flex column** and (b) card top padding = `--fab-space-lg`. The game's `.fab-modal-card--image` is a plain block with `padding: 64px 30px 30px` (`theme.ts:313-318`), so `align-self` is ignored (→ left-aligned block) and the ~-40px margin can't beat the 64px padding (→ ribbon sits fully inside the card, ~24px below its top). Both variants (pause = in-game settings, menu settings) share this one `mountModalShell` path (`src/menu/settings.ts:107-120`). "Modal sits too low" follows from the same bug: the in-flow ribbon adds ~90px to card height, shifting the `margin-block:auto` centering; restoring the overhang restores the ref centering.
3b. **Pause Restart/Home colors are literally swapped in `settings.ts:74-96`**: Restart has `buttonGreen`, Home has `buttonOrange`. v1 ref (refs/pause.png): Restart is the yellow/orange pill, Home is the green pill. (`Button_Orange.png` is the sprite rendering as the yellow pill in v2caps6/pause.png — no separate yellow asset exists; the swap is the whole fix.) Ref also shows the action rows inset (~55% card width, centered), not stretched.
5. **Win reward strip vs stack.** `buildRewardRow` (`src/ui/LevelCompleteOverlay.ts:93-109`) appends REWARD word-art + coin + `+25` into one `inline-flex` row styled as a white pill (`theme.ts:360-372`). v1 ref (refs/win.png): white REWARD word-art **stacked above** a coin+`+25` row, no pill background, `+25` in white with dark outline, directly on the card body.

**Verification method is card-mandated (learned from MRV2-12/13):** every defect gets a headless dist screenshot at 390×844 diffed by eye against the ref PNG before handoff. The repo already has the pattern (`scripts/verify-home-preview.mjs`, vite preview + playwright) and named drivable states for exactly these surfaces (`src/testing/pixelsmithStates.ts`: `home-fresh`, `level-map`, `pause`, `settings`, `win`).

## Key Technical Decisions

- **KTD1: Fix the home budget by deleting dead vertical space, not by shrinking art.** Game-CSS overrides only: `#home-shell .fab-levelmap-path { min-height: 0; }` (kills ~175px of centered dead band; the rail `::before` spans the path box so it also stops painting into empty space) and tighten the preview spacer (`.marble-home-board-preview-slot` toward `max-height: ~210px`, tuned headlessly against refs/home-fresh.png so the chain hangs off the board bottom like v1). Keep the 148px button reserve. Budget check at 390×844: 190 + ~215 + ~285 ≈ 690 ≤ 696.
- **KTD2: Un-stretch the fixed actions container.** `.marble-ui .fab-home-menu-actions { width: max-content; }` in the game override block — the button then sizes from its own `min-width: 220px` rule (`theme.ts:247-254`) like v1. Fixes the full-bleed button on BOTH home-fresh and level-map (defects 1 and 2's button component).
- **KTD3: Make the game card honor the kit ribbon contract instead of fighting it.** `.marble-ui .fab-modal-card--image { display: flex; flex-direction: column; }` (children are ribbon/close(absolute)/body/actions — order and stretch semantics unchanged) so `align-self: center` centers the ribbon, plus a game override `margin-top: calc(-64px - var(--fab-ribbon-overhang))` on `.fab-modal-card--image > .fab-modal-ribbon` to cancel the 64px sprite padding (tune the constant headlessly; ref shows roughly half the ribbon above the card edge). Widen `--fab-ribbon-width` on these cards toward `min(88vw, 380px)` so the ribbon overhangs the card sides like refs/pause.png. NO packages/ui edits.
- **KTD3-guard: the win card uses the same `.fab-modal-card--image` class** and already carries its own ribbon lift (`theme.ts:394-396`, `-72px` extra). Any change to the shared card/ribbon baseline MUST be re-verified against refs/win.png in the same headless pass; adjust the completion-mode override so the win composition is pixel-unchanged (it was accepted in round 6 except the reward row).
- **KTD4: Pause colors are a two-line sprite swap** in `settings.ts` (Restart→`buttonOrange`, Home→`buttonGreen`). Plus inset rows: `.marble-ui .marble-settings-action { width: min(60%, 220px); margin-inline: auto; }` per ref proportions (tuned headlessly).
- **KTD5: Reward stack is a DOM restructure + CSS, single source.** `buildRewardRow` becomes a column wrapper: REWARD word-art img on top, then a `.marble-reward-coinrow` (coin img + `+value` span). Restyle `.marble-reward-row`: flex column, centered, `background: none`, gap ~6px; value text white `var(--fab-font-number)` with dark text-shadow per ref. Keep the `marble-reward-row` class name so `mountResultCard`'s `rewardDisplay` slot and existing tests keep their hook.
- **KTD6: Evidence via one new headless script, reusing the proven pattern.** `scripts/verify-wave7.mjs`: build → `vite preview` → playwright iPhone-ish 390×844 → for each of the five states (`home-fresh`, `level-map`, `pause`, `settings`, `win`) drive the state (fresh localStorage for home-fresh; seeded progress for level-map at level 110; the pixelsmith state drives / DOM clicks for pause/settings/win), `waitForSelector` on the state's distinguishing element (never fixed sleeps), screenshot to `games/marble_run/evidence/mrv2-14/<state>.png`. Assertions are geometric where deterministic (sun node 1 rect fully above the LEVEL button rect; button width < 300px; ribbon rect top < card rect top and centers aligned; Restart button computed background contains Button_Orange; REWARD img rect fully above coin rect). Eyeball each PNG against the corresponding refs/ PNG before handoff. Run with `node`; NOT wired into e2e close-out (policy).

## Implementation Units

### U1. Home/level-map vertical budget + button width (defects 1, 2)

**Files:** `design/theme.ts` only (saga `min-height:0` override, spacer `max-height` retune, `.fab-home-menu-actions { width: max-content }`).

**Approach:** KTD1 + KTD2. Do NOT touch node DOM order, `HomeBoardPreview`, or the fixed-canvas rules (wave-6 verified). Keep `#home-shell .fab-levelmap-node.current { z-index: 21 }` — with the budget fixed the chain ends above the button and the overlap disappears on its own.

**Test scenarios:** unit CSS-pinning (wave-6 test style, `tests/unit/device-parity-wave6.test.ts` as the template — new `device-parity-wave7.test.ts`): theme text contains the `min-height: 0` path override and `width: max-content` actions rule; spacer max-height under 230px.

**Verification:** `node scripts/verify-wave7.mjs` — home-fresh: node-1 sun rect above button rect, both fully in viewport; button width < 300px. level-map: node 106 above button, button bottom-most. Eyeball vs refs/home-fresh.png + refs/level-map.png.

### U2. Modal ribbon overhang + centering (defects 3, 4)

**Files:** `design/theme.ts` (card--image flex column, ribbon margin/width overrides, settings-action inset width).

**Approach:** KTD3 + KTD3-guard + KTD4's width rule. One shared fix covers pause AND settings (same mount path). Re-tune the completion-mode ribbon constant in the same edit so refs/win.png composition is preserved.

**Test scenarios:** unit: theme text pins flex-column card, ribbon margin override, and that the completion-mode ribbon rule still exists.

**Verification:** verify-wave7 pause + settings shots: ribbon horizontally centered on card (|ribbon.cx − card.cx| < 4px), ribbon top above card top; card vertically centered (|card.cy − viewport.cy| small). Eyeball vs refs/pause.png + refs/settings.png, and win shot unchanged vs refs/win.png.

### U3. Pause Restart/Home sprite swap (defect 3)

**Files:** `src/menu/settings.ts` (swap `spriteImage` values).

**Test scenarios:** unit: in-game variant model/DOM — Restart action carries Button_Orange, Home carries Button_Green (extend the existing settings unit coverage; check `tests/unit` for the current settings spec and update any pinned expectation of the old mapping).

**Verification:** verify-wave7 pause shot: computed `--fab-btn-sprite-image`/background of `[data-fab-action="settings-restart"]` contains `Button_Orange`, `settings-home` contains `Button_Green`. Eyeball vs refs/pause.png.

### U4. Win reward stack (defect 5)

**Files:** `src/ui/LevelCompleteOverlay.ts` (`buildRewardRow` column restructure), `design/theme.ts` (`.marble-reward-row` restyle + `.marble-reward-coinrow`).

**Approach:** KTD5. Single-source: REWARD word-art img is the only "REWARD" text (alt text only for a11y); `+25` stays a span. Check `tests/unit/shell-results.test.ts` — it references the reward row; update its DOM expectations to the stacked shape.

**Verification:** verify-wave7 win shot: REWARD img rect fully above coin rect; no pill background (sample computed background-color is transparent). Eyeball vs refs/win.png.

### U5. Headless evidence script + close-out

**Files:** `scripts/verify-wave7.mjs` (new, modeled on `scripts/verify-home-preview.mjs`), evidence PNGs under `games/marble_run/evidence/mrv2-14/`.

**Approach:** KTD6. States that need progress (level-map at 110) seed localStorage via the same keys `GameState` persists (`STORAGE_KEYS.LEVEL` etc. — read `src/core/GameState.ts:881-905` for exact keys) before first navigation. Pause/settings/win: drive via DOM (tap gear on home → settings; start level → gear → pause variant; win via the harness/pixelsmith drive if exposed on `window`, else seed-and-complete the shortest level — pick whichever the existing harness exposes in dist builds; `src/testing/TestHarness.ts` is bundled per `bootstrap.ts`).

**Close-out (worker verification):** `npm run typecheck`, `npm run test:unit`, `npx eslint .` (game scope), `node scripts/verify-wave7.mjs` — state the five evidence PNG paths in the handoff. NO browser-e2e suite, NO PRs, no `packages/ui` diffs (`git diff --stat` must show `games/marble_run/**` + this plan only).

## Risks

- **Shared card class blast radius:** `.fab-modal-card--image` flex-column also hits the fail overlay and finale. Mitigate: verify-wave7 win shot + a quick manual look at the fail overlay DOM in the same session if cheap; fail card uses the same ribbon contract so the fix should improve it identically (same direction as refs).
- **Ribbon constants are sprite-dependent:** tune `-64px − overhang` and ribbon width against the refs headlessly; do not hand off blind values (card mandate).
- **Budget numbers are estimates:** the 190/264/455 arithmetic is planning-grade; the headless loop is the arbiter. If the chain still clips at 390×844 after `min-height:0`, take the remainder out of the spacer, never out of the button reserve (that reserve is what keeps node 1 clear of the button).
