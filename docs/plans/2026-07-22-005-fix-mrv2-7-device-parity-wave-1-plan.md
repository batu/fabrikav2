---
title: "fix: MRV2-7 device parity fixes wave 1 (notifications, background, banner title, HUD chrome, node art)"
date: 2026-07-22
type: fix
origin: trello-card-L1q1wR6T (card description; no brainstorm doc)
trello: https://trello.com/c/L1q1wR6T
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-7 device parity fixes wave 1

## Summary

First on-device Pixelsmith pass (iPhone 12, at-rest home screen) found five parity defects in games/marble_run vs canonical v1 Sugar3D. All five have deterministic root causes in shell_template leftovers that the MRV2-3/5 shell port did not neutralize. Reference truth: `games/marble_run/refs/captures/android-basegamelab/menu.png` (v1 home: purple bubble field, wooden banner with "Marble Run" title text, coin pill top-left + gear top-right only, gold-sun current node, wooden medallion numbered nodes).

Scope fence: `games/marble_run/**` only. No `packages/ui` edits. No PRs. Device parity is conductor-judged after landing; worker verification is code health only.

## Problem Frame / Root Causes (investigated)

1. **Notifications prompt (P0)** — `src/bootstrap.ts` calls `notificationService.install()` and `void notificationService.maybePromptOnLaunch()` (lines ~45–46). `maybePromptOnLaunch` fires the one-time OS permission prompt on the 2nd app open (`DEFAULT_PERMISSION_PROMPT_LAUNCH = 2`); `install()` registers suspend-time scheduling. v1 never requests notification permission.
2. **Background** — three stacked shell_template leftovers paint over the intended purple bubble field from `design/theme.ts` `installShellArt()`:
   - `index.html` has `data-scheme="mint"` on `<html>` plus inline cream/orange gradients on `body`/`#game-container`.
   - `src/ui/styles.css` `#hud-overlay.home-mode` sets an opaque cream gradient background, re-pointed at `--sch-*` scheme tokens later in the file (mint = pale green), covering the body gradient entirely on home.
   - `#hud-overlay.home-mode::before` tiles `/ui/home/pattern-motif.png` (the star/sparkle motif seen on device).
3. **Banner title** — `public/v1/ui/marble-run-banner.webp` is the *empty* wooden banner (verified by opening the asset). v1 renders "Marble Run" title inside it (brown rounded text, Fredoka-style). No title art asset exists anywhere in the ported tree or refs/assets — the title must be rendered as DOM text using the ported FredokaOne font.
4. **HUD chrome on home** — `initHUD()` (called at boot in `src/bootstrap.ts`) injects `.hud-top-bar` with dog-counter `0/0`, hearts, hint pill, coin pill, settings into `#hud-overlay`. Nothing in `styles.css` hides `.hud-top-bar` when `home-mode` is active, so it renders on top of the marble home shell (which already has its own coin pill + gear via `src/menu/homeMenu.ts`).
5. **Node art** — `design/theme.ts` `MARBLE_LEVELMAP_THEME` already wires `level-node-{default,locked,completed,current}.webp` (gold sun current, wooden medallions). Needs verification against `refs/captures/android-basegamelab/menu.png` (art identity, number font/color, sizes), not blind retuning.

## Key Technical Decisions

- **KTD1: Dormant, not deleted, notifications.** Remove the two bootstrap calls only. `NotificationService` module, its unit tests, and the settings-toggle path (user-initiated, in `HUD.ts`/settings) stay. This matches the card ("leave plumbing dormant, no permission request at boot") and keeps the seam testable.
- **KTD2: Fix background at the game layer, no `packages/ui` edits.** Change `index.html` (drop `data-scheme="mint"`, purple inline gradients) and override/replace the `#hud-overlay.home-mode` background + `::before` motif in game-local CSS to the purple gradient + `marble-shadow-tile.png` motif already defined in `design/theme.ts`. Prefer editing the game-local `styles.css` rules in place over adding higher-specificity overrides (single source of truth; styles.css is game-owned).
- **KTD3: Banner title as DOM text, not new art.** Render "Marble Run" as a positioned text overlay inside `.marble-home-banner` using the ported FredokaOne font and a brown fill matching the reference. Deterministic, no asset generation, matches v1's look closely.
- **KTD4: Hide `.hud-top-bar` in home-mode via CSS** (`#hud-overlay.home-mode .hud-top-bar { display: none; }`) rather than restructuring `initHUD()` — smallest change; gameplay HUD is untouched.

---

## Implementation Units

### U1. Remove notification bootstrapping at boot

**Goal:** No notification permission request or scheduling installation at app boot; plumbing stays dormant.
**Files:** `games/marble_run/src/bootstrap.ts`; existing notification unit tests under `games/marble_run/tests/` (adjust only if they assert boot wiring).
**Approach:** Delete the `notificationService.install()` and `void notificationService.maybePromptOnLaunch()` calls (and the now-unused import if nothing else in bootstrap uses it). Update the adjacent comment. Leave `src/notifications/NotificationService.ts` untouched.
**Test scenarios:**
- Boot path test (if one exists asserting install/prompt is called): invert to assert notification service is NOT installed/prompted at boot.
- `NotificationService` unit tests continue to pass unchanged (module untouched).
**Verification:** `grep` shows no boot-path caller of `install`/`maybePromptOnLaunch`; typecheck + unit green; eslint no unused-import errors.

### U2. Purple bubble home background

**Goal:** Home renders the v1 purple field with subtle marble/bubble motif; no mint/cream/star leftovers.
**Dependencies:** none.
**Files:** `games/marble_run/index.html`, `games/marble_run/src/ui/styles.css`, `games/marble_run/design/theme.ts` (reference values), possibly `games/marble_run/src/core/Constants.ts` (`COLORS.BG` canvas color to a matching purple so scene transitions don't flash cream).
**Approach:** (a) `index.html`: remove `data-scheme="mint"` (or introduce no scheme), change body/`#game-container` inline gradients to the purple gradient used in `installShellArt` (`#9b7bcd → #6b568e`); remove stale shell_template icon preloads pointing at `/ui/menu-icons/*` and `/ui/home/*` if those assets are not shipped (check first — 404 preloads are console noise on device). (b) `styles.css`: repoint `#hud-overlay.home-mode` background (both the base rule ~line 2705 and the scheme-token rule ~line 4704) to the purple gradient, and change `::before` motif from `/ui/home/pattern-motif.png` to `/v1/ui/marble-shadow-tile.png` at the theme.ts tile size/opacity — or remove the home-mode background entirely and let the `installShellArt` body layer show through if `home-mode` can go transparent safely. Pick whichever is smaller after reading how gameplay/overlays rely on `home-mode` background.
**Test scenarios:** Test expectation: none — pure CSS/asset wiring; covered by device capture (conductor) and existing shell smoke tests.
**Verification:** Local dev-server render shows purple field + marble tile motif on home (worker sanity only; device parity is conductor-judged). No references to `pattern-motif.png` or mint scheme remain in marble_run home path.

### U3. Banner title

**Goal:** Wooden banner displays the "Marble Run" title matching v1.
**Dependencies:** none.
**Files:** `games/marble_run/src/menu/homeMenu.ts`, `games/marble_run/design/theme.ts` (CSS in `installShellArt`).
**Approach:** In `buildHeader`, add a title element inside `.marble-home-banner` overlaying the banner image (banner becomes `position: relative`, title absolutely centered). Style in `installShellArt`: FredokaOne, brown (~`#6a3016` family per reference), sized relative to banner width (e.g. `clamp`/vw-based) so it stays inside the gold plate. Keep the existing `alt="Marble Run"` img.
**Test scenarios:**
- HomeMenu mount test (if `homeMenu` has one): banner contains a title element with text "Marble Run".
**Verification:** Dev-server render shows titled banner; typecheck/unit green.

### U4. Remove non-canonical HUD chrome from home

**Goal:** Home shows only the marble header (coin pill left, gear right, banner) — no hint bulb, hearts, or `0/0` dog counter.
**Dependencies:** none (independent of U2 but same file `styles.css`).
**Files:** `games/marble_run/src/ui/styles.css` (or `src/ui/HUD.ts` if a class hook is missing).
**Approach:** Add `#hud-overlay.home-mode .hud-top-bar { display: none; }` (and any sibling gameplay-only chrome that renders at home, e.g. toasts anchored to the bar). Gameplay entry removes `home-mode` (`hideHomeMenuLayer`), so the gameplay HUD is unaffected.
**Test scenarios:** Test expectation: none — CSS visibility rule; behavior proven by device capture. If a cheap DOM test exists for home mount, assert `.hud-top-bar` is not visible in home-mode.
**Verification:** Dev-server home shows only marble header chrome; gameplay still shows full HUD.

### U5. Verify level-node art vs v1

**Goal:** Confirm (and align if needed) node art: gold-sun current node, wooden-medallion locked/default nodes, number style per `refs/captures/android-basegamelab/menu.png`.
**Dependencies:** U2 (background change may affect readability judgments).
**Files:** `games/marble_run/design/theme.ts` (`MARBLE_LEVELMAP_THEME` tokens), `games/marble_run/public/v1/ui/level-node-*.webp` (read-only comparison).
**Approach:** Open each `level-node-*.webp` and compare against the reference capture (art identity, which asset maps to which state, number font/size/color tokens). Adjust only theme tokens (sizes, fonts, colors) or asset-to-state mapping if a mismatch is found. Do NOT regenerate art or blind-tune pixels.
**Test scenarios:** Test expectation: none — token/asset verification; final judgment is the conductor's device capture.
**Verification:** Written note in the handoff of what was compared and any token changes made.

---

## Verification Contract

- `npm run typecheck`, unit tests, and `npx eslint .` (marble_run scope) green — the card's stated worker-level bar.
- Local dev-server visual sanity of home (worker-only sanity, explicitly NOT device proof).
- **Device parity remains conductor-judged** — on-device capture and diff vs `iphone-v2-atrest.png` / v1 reference happens after landing; the handoff must state this.

## Scope Boundaries

- In: `games/marble_run/**` only.
- Out: `packages/ui` (kit) edits — even where a kit default is the tempting fix, override at the game layer. No PRs; conductor merges the branch.
- Deferred: any retention-notification re-enable decision; menu vignette (config is `'none'`); gameplay-screen parity (later wave).

## Risks

- U2 has three interacting background layers (inline html, `home-mode` CSS, scheme tokens); missing one leaves a leftover on device that only the conductor's capture will reveal. Mitigation: grep for `mint`, `pattern-motif`, and the cream hex values after the change.
- Title typography is judged on device; DOM-text approach may need a size/weight nudge in a later wave — acceptable, deterministic knobs.

## Definition of Done

All five units landed on branch `trello-L1q1wR6T-mrv2-7-device-parity-fixes-wave-1-notifi`; typecheck/unit/eslint green; handoff states device parity is unverified pending conductor device capture.
