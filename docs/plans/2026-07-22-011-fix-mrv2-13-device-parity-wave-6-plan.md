---
title: "fix: MRV2-13 device parity wave 6 (preview board regression, settings card top, win ribbon position)"
date: 2026-07-22
type: fix
origin: trello-card-zSBPgnZu (card description; no brainstorm doc)
trello: https://trello.com/c/zSBPgnZu
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-13 device parity wave 6

## Summary

Round-5 judge: gameplay clean; three surfaces left (refs/, v2caps5/, judge5/ under `/private/tmp/claude-501/-Users-base-dev-appletolye/fe715c29-d217-442f-b369-42c6d456569f/scratchpad/`). Scope fence: `games/marble_run/**` only, **no `packages/ui` edits**, no PRs. Worker verification: headless playwright board-pixels check for defect 1 + typecheck + unit + eslint; device parity is conductor-judged.

**All three defects were root-caused during planning by reading the tree and reproducing #1 headlessly** (playwright against `vite preview` of the dist build, 393×852):

1. **Preview board regression — CONFIRMED headlessly, exact cause known.** The wave-5 full-bleed canvas rule `.marble-ui > .marble-home-board-preview { position: fixed; inset: 0; z-index: 0; … }` (`design/theme.ts:227`) **never applies**: the preview canvas lives inside `#game-container` (as a child of `#hud-overlay`), so the gameplay rule `#game-container canvas { position: relative; z-index: 1; }` (`src/gameplay/hud.css:54-57`, specificity 1-0-1) beats the theme rule (0-2-0). Probe result on the dist build: canvas present, `matches('.marble-ui > .marble-home-board-preview') === true`, computed `position: relative`, `z-index: 1`, bounding rect `y ≈ 991` on an 852px viewport — the canvas is in normal flow, pushed **below the viewport** by the home shell content. The board renders fine; it's just off-screen. (This also explains "background only" on device — same cascade, not a WebGL/device issue.) The headless probe also showed the boot is timing-sensitive (one run at 15s had no canvas yet), so the acceptance check must wait for the canvas element, not a fixed sleep.
2. **Settings card top cropped + X above banner.** Wave-5 added `.marble-ui .fab-modal-card { max-height: …; overflow-y: auto; }` (`design/theme.ts:299-302`) to stop top-cropping of tall cards. But the kit's ribbon banner is a card CHILD pulled above the card's top edge by negative margin (`packages/ui/src/ui.css:310-321`, `--fab-ribbon-overhang`), so `overflow-y: auto` on the card **clips the ribbon overhang and the card's top rounded corners** — exactly the round-5 symptom. The close X (`.fab-modal-close`, absolute `top/right: var(--fab-modal-close-inset)` = 10px inside the card, `ui.css:298-307`) then reads as floating "above the banner" against the clipped top. Ref `refs/settings.png`: full card visible, ribbon overhanging, X on the card's top-right corner.
3. **Win ribbon overlaps card interior.** Same mechanism family: the LEVEL 1 COMPLETED ribbon is a card child with the kit's default ~20px overhang, so most of the ribbon sits INSIDE the card; ref `refs/win.png` wants it above/outside the card's top edge. Needs a larger negative top margin for the completion ribbon (game CSS), which is only possible once the card no longer clips overflow (defect 2's fix is a prerequisite).

## Key Technical Decisions

- **KTD1: Fix the cascade at the gameplay rule, and make the preview rule id-strength.** Scope `hud.css` to the Phaser canvas only: `#game-container > canvas` (the Phaser canvas is the only stylesheet-positioned direct-child canvas; the gameplay three.js canvas uses inline styles, `GameplayController.ts:108-118`, so it is unaffected either way). Belt-and-braces: change the theme selector to `#hud-overlay > .marble-home-board-preview` (1-1-0 beats 1-0-1) so no future descendant-canvas rule can silently swallow it again. Keep everything else about the wave-5 full-bleed approach (it was correct; only the cascade was wrong).
- **KTD2: Card must never be the scroll/clip container — the backdrop is.** Ribbon overhang and rounded corners require `overflow: visible` on the card. To keep the wave-5 guarantee that a tall card can't top-crop, move it to the supported pattern: `.fab-modal-backdrop { overflow-y: auto; }` + `.fab-modal-card { margin-block: auto; }` (flex column context: auto margins center when content fits and pin the top visible when it overflows). Drop the card `max-height`/`overflow-y: auto`. This heals defects 2 and 3's clipping in one move and applies to settings, win, fail, and finale alike.
- **KTD3: X on the card corner via the kit token.** After KTD2 the card top is visible again; dock the X at the card's top-right corner per ref by tuning `--fab-modal-close-inset` in game CSS (start ~`-8px` so the 52px blue square straddles the corner like `refs/settings.png`; exact value is conductor-judged). No kit edit — the token is the supported surface.
- **KTD4: Completion ribbon lifted above the card via game CSS.** For the win overlay only (`#modal-root.completion-mode`), enlarge the ribbon's negative top margin so the sprite sits above/outside the card's top edge with only a small overlap (ref shows the ribbon bottom just kissing the card top). Use the kit variable if sufficient (`--fab-ribbon-overhang`) or a scoped `.completion-mode .fab-modal-ribbon { margin-top: … }` override; keep the single-COMPLETED-source invariant from wave 4/5.
- **KTD5: Acceptance for #1 is a deterministic headless script, not the e2e suite.** Add `scripts/verify-home-preview.mjs`: build → `vite preview` → playwright (393×852) → `waitForSelector('.marble-home-board-preview')` → assert computed `position: fixed` and rect `{0,0,vw,vh}` → screenshot → assert board pixels present (sample center region for non-background pixels, i.e. pixels that differ from the purple gradient/bubble field). Run directly with `node`; do NOT wire into `test:e2e`-style close-out (policy: browser e2e is not a game close-out — this is the card-mandated targeted headless check for a rule-cascade fix, run once as evidence).

## Implementation Units

### U1. Preview board cascade fix

**Goal:** Full-bleed tilted framed board visible behind the home/level-map DOM again (defect 1).

**Files:** `src/gameplay/hud.css` (`#game-container canvas` → `#game-container > canvas`), `design/theme.ts` (preview selector → `#hud-overlay > .marble-home-board-preview`; update the adjacent comment to name the cascade trap).

**Approach:** Per KTD1. No changes to `HomeBoardPreview.ts`, `Stage.ts`, or mount code — headless probe proved the render/mount path works; only the cascade was wrong. Verify the gameplay board lift still works: the `::before` bubble layer sits at z0 and the Phaser canvas must stay z1 during gameplay (`hud.css:52-57` comment) — the Phaser canvas is a direct child of `#game-container`, so `>` preserves it.

**Test scenarios:** unit (jsdom): theme CSS text contains the `#hud-overlay > .marble-home-board-preview` fixed rule; hud.css child-combinator rule present (string assertion in the existing CSS-pinning test style used by waves 3-5, if such a test file exists for these sheets — else add to `tests/unit`).

**Verification:** `node scripts/verify-home-preview.mjs` (U4) green: fixed-position rect at viewport size + board pixels in the screenshot.

### U2. Modal clip fix: backdrop scrolls, card doesn't (settings top + corners + X)

**Goal:** Settings card fully visible with ribbon overhang and rounded top corners; X docked on the card's top-right corner (defect 2).

**Dependencies:** none (parallel to U1).

**Files:** `design/theme.ts` (`.fab-modal-card` drop `max-height`/`overflow-y:auto`; add backdrop `overflow-y:auto` + card `margin-block:auto`; set `--fab-modal-close-inset` per KTD3).

**Approach:** Per KTD2 + KTD3. Keep the wave-5 safe-area padding on the backdrop. Check the kit backdrop is `display:flex` column-compatible for `margin-block:auto` centering (`packages/ui/src/ui.css:228-240` READ-ONLY; if it's not flex, add `display:flex; flex-direction:column` in the game override — the win completion mode already sets flex-direction column at `theme.ts:377-381`, keep them consistent).

**Test scenarios:** unit: theme CSS no longer sets `overflow-y: auto` on `.fab-modal-card`; backdrop scroll rule + close-inset token present; existing settings mount/variant tests stay green.

**Verification:** typecheck + unit + eslint; visual is conductor-judged against `refs/settings.png`.

### U3. Win ribbon above the card

**Goal:** LEVEL 1 COMPLETED ribbon sits above/outside the card's top edge (defect 3, ref `refs/win.png`).

**Dependencies:** U2 (overflow must be visible or the lifted ribbon gets clipped).

**Files:** `design/theme.ts` (completion-mode ribbon margin/overhang override), `tests/unit/shell-results.test.ts` (pin the override's presence if the suite pins CSS there).

**Approach:** Per KTD4. Keep coin pill, standalone Next, and translucent scrim from wave 5 untouched.

**Verification:** typecheck + unit; position is conductor-judged.

### U4. Headless board-pixels acceptance script

**Goal:** Card acceptance for #1: deterministic proof the board renders in the dist build.

**Dependencies:** U1.

**Files:** `scripts/verify-home-preview.mjs` (new).

**Approach:** Per KTD5. Wait on the canvas selector (boot is timing-sensitive — a fixed sleep raced during planning probes), assert computed fixed/viewport geometry, then decode the screenshot (playwright's PNG via `page.screenshot` + pixel sampling, e.g. with `pngjs` if already in the workspace tree, else compare two screenshots — home with preview vs. `page.evaluate` hiding the canvas — and require a large diff; pick whichever avoids adding a dependency, per no-new-deps boundary). Print PASS/FAIL + save the screenshot beside the evidence dir.

**Verification:** run it; paste its output in the handoff/commit.

### U5. Close-out

`npm run typecheck`, `npm run test:unit`, `npx eslint .` scoped to the game, `node scripts/verify-home-preview.mjs`. List all device visuals as remaining for the conductor's round-6 device judge. Commit style: `fix(MRV2-13): device parity wave 6 (…)` matching prior waves.

## Boundaries

- `games/marble_run/**` only; `packages/ui` is READ-ONLY reference.
- No new npm dependencies without asking.
- No PRs; conductor merges. No browser e2e as close-out beyond the targeted U4 script.
- Do not touch gameplay visuals (judged clean in round 5); the hud.css edit must keep the Phaser-canvas z-lift behavior during gameplay.
