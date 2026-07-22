---
title: "fix: MRV2-19 gameplay HUD majors sweep"
date: 2026-07-22
type: fix
origin: trello-card-1zE626GA (card description; no brainstorm document)
trello: https://trello.com/c/1zE626GA
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-19 gameplay HUD majors sweep

## Goal Capsule

Bring the in-level Marble Run HUD back to the canonical v1 `gameplay-opener` composition: chunky filled pale-lavender numerals with a dark shadow, a muted tan HINT panel with a lavender-gray rim, coin icon followed by value in the bottom-left cyan pill, and flat red heart glyphs in the top-left teal frame.

The Trello card and its supplied canonical v1 capture are the visual authority.
Source edits are limited to `games/marble_run/src/gameplay/**`, `games/marble_run/src/gameplay/hud.css`, and, only if font registration needs correction, `games/marble_run/design/theme.ts`.
No `packages/ui` change, new art asset, gameplay-rule change, pull request, or source-tree evidence output is authorized.

---

## Product Contract

### Summary

The existing HUD already mounts the correct v1 frame and coin assets and preserves coin-before-value DOM order, but its numerals and HINT text read as thin outlined gray, the booster image is bright yellow/white, and the heart treatment adds an overly heavy outline/glow.
This pass corrects that presentation without changing HUD behavior, placement ownership, or economies.

### Requirements

- R1. Currency value, HINT label, and HINT cost use the registered `FredokaOne` display face as filled pale-lavender lettering with a dark purple shadow instead of thin outlined gray lettering.
- R2. The HINT booster reads as muted orange/tan with a lavender-gray surrounding rim, rather than bright yellow/white, while retaining the existing control hit target, disabled treatment, and coin-cost content.
- R3. The bottom-left cyan currency pill retains the v1 icon-left, value-right sequence and aligns its icon/value cluster within the existing frame.
- R4. The top-left goals frame shows five flat red heart glyphs with v1-like spacing and subdued treatment; no unavailable heart sprite is invented.
- R5. Gameplay HUD interactions and loss-state behavior remain unchanged: settings opens, hint affordability continues to govern disabled state, and trailing lost hearts remain marked dead.

### Acceptance Examples

- AE1. Given `?insituTour=gameplay-opener` at 390×844 after the tour-state marker settles, when its HUD is captured, then its number and HINT lettering are visibly chunky pale lavender with a coherent dark shadow.
- AE2. Given the same state, when the HINT panel is compared beside the canonical capture, then its panel reads muted tan and its rim reads lavender-gray without changing the existing button geometry.
- AE3. Given the same state, when the hearts and bottom coin pill are compared beside the canonical capture, then five flat red hearts occupy the teal goals frame and the coin icon visibly precedes the value in the cyan pill.

### Scope Boundaries

- Keep runtime edits in the card-authorized Marble Run HUD/theme files; treat existing `games/marble_run/tests/unit/gameplay-hud.test.ts` as a read-only behavioral regression guard unless the card scope is explicitly expanded.
- Do not replace the ported `Button_Booster.png`, `Frame_Currency.png`, `Frame_Goals.png`, or coin asset; tune their presentation only.
- Do not add a heart image: no heart sprite exists in the ported `public/v1/ui/vida/GameScreen` set, so the existing glyph implementation is the approved approximation.
- The requested headless capture is required comparison evidence, but a real mobile WebView capture remains the final visual authority.

### Product Contract Preservation

Product Contract unchanged from the Trello card; the plan narrows implementation to presentation parity and preserves all existing HUD structure and interactions.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Reuse the existing `FredokaOne` registration in `games/marble_run/design/theme.ts` and the HUD's `--vida-font-number` variable. Correct the affected selector color, stroke, and shadow treatment rather than introducing a second font or changing gameplay markup.
- KTD2. Preserve the existing `currencyCounterHtml` child order because `games/marble_run/tests/unit/gameplay-hud.test.ts` already pins the icon before the value. Tune only the flex alignment, gap, sizing, and numeral styling required by the reference.
- KTD3. Desaturate and warm the existing booster art through a narrowly scoped CSS visual treatment so its yellow face reads tan and its pale rim reads lavender-gray. This is an approximation constrained by the existing art bytes; do not fabricate or import a sprite.
- KTD4. Keep the current `❤` glyph fallback because the ported tree has no v1 heart sprite. Remove the non-reference heavy outline/glow and tune fill, font fallback, spacing, and loss-state contrast to make the result read as flat red glyphs on the goals frame.
- KTD5. Use a short, repeated harness-enabled Playwright capture loop against the supplied `gameplay-opener` reference after each visual adjustment. Store each generated capture, diff, and any derived build output only under `$TWF_OUT_DIR`.

### Patterns and Constraints

- Follow `games/marble_run/src/gameplay/hud.ts` for the established frame assets, semantic classes, settings/hint callbacks, affordability state, and heart-loss DOM contract.
- Follow the existing style isolation under `.mr-gameplay-screen` in `games/marble_run/src/gameplay/hud.css`; no generic shell or shared-kit selector may be widened.
- The existing `@font-face` for `FredokaOne` in `games/marble_run/design/theme.ts` is the font-registration precedent.
- Follow the harness tour-state marker pattern already used by `tools/marble-run/verify-wave8.mjs`; its browser lane is a card-required visual diagnostic, never device proof.

### Assumptions

- The canonical capture's glyph and panel pixels, rather than a new image asset, are the acceptance target for this scoped CSS pass.
- Current gameplay HUD markup is sufficient because it already carries the correct frames, coin order, five heart slots, cost content, and interaction hooks.

### Sequencing

First make the text and booster colors read correctly against the canonical capture, then tune the fixed coin and heart compositions without disturbing their DOM contracts.
After every change, rebuild the harness-enabled surface, capture `gameplay-opener` at 390×844, and compare the HUD regions before running the final code-health gates.

---

## Implementation Units

### U1. Restore chunky lavender number and HINT treatments

**Goal:** Make the currency value, HINT label, and HINT cost read as v1-style filled pale-lavender display lettering with a dark shadow.

**Requirements:** R1, R5; AE1.

**Dependencies:** None.

**Files:** Modify `games/marble_run/src/gameplay/hud.css`; inspect `games/marble_run/design/theme.ts` only to confirm the existing `FredokaOne` registration remains available.

**Approach:** Keep `--vida-font-number` as the one display-face source and apply it consistently to the counter and both HINT text regions. Replace the current prominent blue/ink outline emphasis with a filled pale-lavender color and a compact dark-purple shadow that preserves legibility at the reference scale. Do not alter label text, cost value, button action, or affordability behavior.

**Execution note:** This is CSS-only visual work; use the rendered capture as the proof for glyph weight, fill, and shadow rather than a CSS-string assertion.

**Patterns to follow:** The existing `--vida-font-number`, `.vida-counter-content`, `.hint-label`, and `.hint-cost` rules in `games/marble_run/src/gameplay/hud.css`.

**Test scenarios:**

- Covers AE1. At 390×844, the counter numeral, `HINT`, and `125` all render in the same rounded display family with a pale-lavender fill and visibly darker shadow.
- Hint remains disabled below `HINT_COIN_COST`, enables at the threshold, and retains the existing callback behavior.
- Existing game HUD unit coverage continues to pass for currency updates and hint affordance; no unit-test edit is expected because no DOM or behavioral contract changes.

**Verification:** A harness-enabled `gameplay-opener` screenshot, viewed beside the canonical capture, shows the requested lettering treatment without clipping, overlap, or a fallback font.

### U2. Retint the HINT panel and preserve currency-pill composition

**Goal:** Make the booster read as muted tan with a lavender-gray rim while keeping the coin-left counter layout centered in its cyan frame.

**Requirements:** R2, R3, R5; AE2, AE3.

**Dependencies:** U1.

**Files:** Modify `games/marble_run/src/gameplay/hud.css`; inspect `games/marble_run/src/gameplay/hud.ts` as the read-only currency markup contract.

**Approach:** Apply a CSS-only visual adjustment to the existing booster image so its saturated yellow/white artwork settles into the supplied reference's subdued tan and lavender-gray palette without changing dimensions, hit area, or disabled opacity. Keep the coin `<img>` before the value span and tune only the content cluster's existing layout properties when the screenshot shows mis-centering or spacing drift.

**Execution note:** Use the exact 390×844 capture after every palette or spacing adjustment; stop at the smallest scoped treatment that makes the panel and pill read as the reference.

**Patterns to follow:** `Button_Booster.png` and `Frame_Currency.png` layering in `games/marble_run/src/gameplay/hud.ts`, plus `.hint-btn-art` and `.vida-counter-content` in `games/marble_run/src/gameplay/hud.css`.

**Test scenarios:**

- Covers AE2. The HINT panel face reads tan and its surrounding rim reads lavender-gray, while the button remains at its existing dimensions and disabled state is still visible.
- Covers AE3. The currency pill displays the coin at the left of the numeric value, and the combined cluster sits within the cyan frame without clipping at its initial value or after a multi-digit update.
- Existing unit coverage continues to prove icon-before-value DOM order and the live coin update path; no unit-test edit is expected because the markup remains unchanged.

**Verification:** The headless comparison capture matches the canonical panel and pill composition closely enough that no bright-yellow/white panel or reversed/misaligned coin layout remains visually prominent.

### U3. Match the goals-frame heart treatment and record visual evidence

**Goal:** Render the available heart glyph fallback as flat red v1-like hearts and leave a reproducible evidence trail for all four HUD corrections.

**Requirements:** R4, R5; AE3.

**Dependencies:** U1, U2.

**Files:** Modify `games/marble_run/src/gameplay/hud.css`; inspect `games/marble_run/src/gameplay/hud.ts` and `games/marble_run/tests/unit/gameplay-hud.test.ts` as read-only contracts; write disposable captures and diffs only under `$TWF_OUT_DIR`.

**Approach:** Simplify `.hearts-content` to a flat red-glyph appearance within the existing teal goals frame, retaining five slots, spacing that visually follows the reference, and the existing `.dead` loss state. Explicitly record in the handoff that no heart sprite exists in the ported game-screen art and that the approved CSS glyph approximation was used. Capture the final `gameplay-opener` surface at 390×844 from a harness-enabled build and compare the four HUD regions against the supplied canonical image.

**Execution note:** The mobile WebView remains authoritative. If an implementation worker cannot make a device capture, it must hand off the browser comparison as proxy evidence and explicitly leave device parity unverified.

**Patterns to follow:** `.hearts-content` and `.hearts span.dead` in `games/marble_run/src/gameplay/hud.css`; existing DOM/loss tests in `games/marble_run/tests/unit/gameplay-hud.test.ts`.

**Test scenarios:**

- Covers AE3. Five red glyphs remain visible and evenly spaced inside the teal goals frame at level open.
- After `setHearts(3)`, only the two trailing glyphs receive the existing dead-state treatment; live hearts remain red and readable.
- The captured HUD has no accidental spill into the board or a visual regression in the existing settings/hint control placement.

**Verification:** A final 390×844 `gameplay-opener` capture and diff under `$TWF_OUT_DIR` are visually inspected against the canonical reference, and the handoff names those paths plus the unavailable-heart-sprite approximation.

---

## Verification Contract

Run the Marble Run typecheck, unit suite, and game-scoped ESLint after the CSS adjustments.
Build with `VITE_ENABLE_TEST_HARNESS=true`, load `?insituTour=gameplay-opener` at 390×844, wait for the published tour-state marker, and capture the settled page after every visual change.

For the final comparison, retain the capture and diff under `$TWF_OUT_DIR` and inspect these regions beside the canonical v1 reference: the counter value, HINT label/cost, HINT panel/rim, coin pill ordering, and goals-frame hearts.

The existing game HUD unit tests must remain green for heart loss, hint affordability/callback, coin update, settings callback, and icon-before-value order.
Do not present the Playwright/browser capture as mobile verification; capture the affected in-level HUD on a real iPhone WKWebView or Android WebView before claiming visual completion, or explicitly defer that gate to the conductor.

---

## Definition of Done

- `gameplay-opener` at 390×844 visibly uses chunky filled pale-lavender HUD/HINT lettering with a dark shadow.
- The HINT artwork reads muted tan with a lavender-gray rim, while its existing action, size, and disabled behavior remain intact.
- The cyan coin pill retains icon-left/value-right layout, and the teal goals frame contains five flat red heart glyphs with preserved loss-state behavior.
- Generated browser artifacts live only under `$TWF_OUT_DIR`; the final handoff names the capture/diff paths and the unavailable-heart-sprite approximation.
- Marble Run typecheck, unit tests, and game-scoped ESLint are green.
- A real-device WebView capture confirms the final result, or the implementation-stage handoff explicitly states that device verification remains open.
- No edit touches `packages/ui`, game rules, HUD interaction semantics, or unrelated presentation surfaces.
