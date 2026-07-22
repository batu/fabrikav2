---
title: "fix: MRV2-15 final parity polish"
date: 2026-07-22
type: fix
origin: trello-card-QW0Dh8zw (card description; no brainstorm document)
trello: https://trello.com/c/QW0Dh8zw
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-15 final parity polish

## Goal Capsule

Close the three remaining Round-7 Marble Run parity defects without changing shared UI packages: give the home sun node visible clearance above the LEVEL 1 button, center the SETTINGS title inside its ribbon, and make only the menu settings variant cover the home scene with an opaque black backdrop. The Trello card and its Round-7 reference/capture set are the behavioral authority. Work stays under `games/marble_run/**`; no pull request or `packages/ui` edit is in scope.

Execution is a small visual-polish pass. The implementation worker owns code, tests, built-dist headless evidence, and honest device verification. The TWF conductor owns landing.

---

## Product Contract

### Summary

MRV2-14 removed the major home and modal layout defects, but its acceptance thresholds allowed the home sun node to nearly touch and remain visually obscured by the fixed CTA. It also verified the ribbon container rather than its title, and retained the shared translucent modal scrim for the menu settings surface. This pass tightens those three seams only.

### Requirements

- R1. On `home-fresh` at 390×844, the complete gold sun node and its `1` glyph remain visibly above the LEVEL 1 button with a positive clearance matching the Round-7 reference.
- R2. On menu settings, the SETTINGS title is horizontally centered within the orange ribbon, independent of the card's placement.
- R3. On menu settings, the backdrop is fully opaque black so no home art, HUD, level path, or LEVEL button remains visible.
- R4. The in-game pause/settings variant keeps its existing dimmed-game backdrop and accepted ribbon composition.
- R5. Existing accepted `level-map`, `gameplay`, `pause`, and `win` behavior does not regress.

### Acceptance Examples

- AE1. Given a fresh save at 390×844, when `home-fresh` settles, then the sun node's full bounding box and numeral are visible and its bottom edge has a deliberate gap above the LEVEL 1 action.
- AE2. Given the home menu, when menu settings opens, then the title center aligns with the ribbon center and the pixels outside the card are opaque black.
- AE3. Given active gameplay, when the in-game settings/pause modal opens, then the gameplay scene remains visible only through the existing dim scrim rather than the menu variant's opaque black treatment.

### Scope Boundaries

- Modify only `games/marble_run/**` plus this plan artifact.
- Do not edit `packages/ui`, change settings navigation semantics, replace assets, or address unrelated Round-7 judge observations.
- Do not use the browser E2E suite as game-worker close-out. The card-specific built-dist screenshot verifier is a targeted diagnostic and acceptance artifact, not a substitute for device proof.

### Product Contract Preservation

Product Contract unchanged from the card: the plan decomposes the three named defects without widening product scope.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Recover sun clearance by retuning Marble-owned home vertical-budget constants in `games/marble_run/design/theme.ts`. Preserve the node order, full board preview, fixed CTA, and bottom safe-area reserve. At the card's 390×844 viewport, require at least 16 CSS pixels between the sun node and CTA; the card's stated remaining 40–60 reference-image pixels correspond to roughly 13–20 CSS pixels at the source capture scale. Z-index overlap alone is not acceptance.
- KTD2. Center the actual `.fab-modal-ribbon-title`, not only its ribbon container. Add a selector scoped to `.marble-settings-card` so completion and failure ribbons retain their accepted geometry.
- KTD3. Mark the modal root with a stable menu-versus-in-game settings variant hook in `games/marble_run/src/menu/settings.ts`, then apply opaque black backdrop styling only to the menu hook in `games/marble_run/design/theme.ts`. Reuse the returned `UiHandle.el`; do not add a shared-kit API or rely on broad modal selectors.
- KTD4. Add a new MRV2-15 verifier and evidence directory rather than overwriting MRV2-14 artifacts. Reuse the existing built-dist `vite preview` plus `?insituTour=` pattern, state-marker waits, and 390×844 viewport.

### Patterns and Constraints

- Follow `games/marble_run/scripts/verify-wave7.mjs` for deterministic preview startup, fresh browser contexts, tour-state readiness markers, geometry sampling, and PNG capture.
- Follow `games/marble_run/tests/unit/device-parity-wave7.test.ts` for cheap game-local CSS regression pins and `games/marble_run/tests/unit/shell-settings.test.ts` for variant DOM hooks.
- Treat `packages/ui/src/ModalShell.ts` and `packages/ui/src/ui.css` as read-only references: the modal backdrop is the `UiHandle.el` root, while the title is absolutely positioned inside the ribbon.
- Real-device safe areas and WebView rendering remain authoritative under project policy. Headless captures satisfy the card's explicit evidence requirement but remain proxy evidence.

### Sequencing

Implement and verify the home clearance independently, then add the settings variant hook and its two scoped presentation rules. Finish by extending automated evidence so each requirement is asserted before the full quality and device gates run.

---

## Implementation Units

### U1. Give the home sun node deliberate CTA clearance

**Goal:** Make the full current sun node readable above LEVEL 1 without disturbing the accepted board, level chain, or CTA.

**Requirements:** R1, R5; AE1.

**Dependencies:** None.

**Files:** Modify `games/marble_run/design/theme.ts`; test `games/marble_run/tests/unit/device-parity-wave7.test.ts` or a new `games/marble_run/tests/unit/device-parity-wave8.test.ts`.

**Approach:** Retune the smallest Marble-local vertical-budget constant around the preview spacer, saga content, or reserved CTA gap. Preserve the 390×844 safe-area budget and all four fresh-home nodes. Replace the prior non-overlap criterion with a minimum 16 CSS-pixel clearance.

**Execution note:** This is visual styling; use a short built-dist screenshot-tuning loop rather than treating a CSS string test as proof.

**Patterns to follow:** The MRV2-14 home overrides and CSS pins in `games/marble_run/design/theme.ts` and `games/marble_run/tests/unit/device-parity-wave7.test.ts`.

**Test scenarios:**

- Covers AE1. At 390×844, the bottom-most fresh-home sun node is fully within the viewport, its `1` remains visible, and its bottom edge clears the LEVEL button by at least 16 CSS pixels.
- The level-map state retains its accepted bottom-node ordering and fixed button placement.
- A 390×780 falsification capture retains all four fresh-home nodes and prevents overlap; this is a responsive guard, not an additional reference-parity target.

**Verification:** The built-dist `home-fresh` screenshot visually matches the Round-7 reference in the node/button region, the 390×844 geometry assertion reports at least 16 CSS pixels of clearance, and the shorter-viewport guard does not overlap. Observe U1 on the real target device before treating the tuned constant as settled because safe-area and WebView font metrics can invalidate the headless value.

### U2. Center the SETTINGS title and isolate menu backdrop opacity

**Goal:** Match the menu settings ribbon title and opaque backdrop while keeping the in-game pause variant dimmed.

**Requirements:** R2, R3, R4, R5; AE2, AE3.

**Dependencies:** None.

**Files:** Modify `games/marble_run/src/menu/settings.ts` and `games/marble_run/design/theme.ts`; test `games/marble_run/tests/unit/shell-settings.test.ts` and the selected device-parity CSS test.

**Approach:** Add a stable menu/in-game variant class or data attribute to the modal root returned from `mountModalShell`. Scope an explicit title-centering rule to the settings card. Scope an opaque black backdrop or scrim rule to the menu variant only, leaving the in-game variant's shared dim behavior intact.

**Execution note:** Establish DOM-hook and CSS-pin regression coverage first, then use screenshots to prove actual alignment and opacity.

**Patterns to follow:** `UiHandle.el` variant hooks in game-owned composition code, the existing `.marble-settings-card` overrides, and `games/marble_run/tests/unit/shell-settings.test.ts` variant assertions.

**Test scenarios:**

- Covers AE2. The menu settings root exposes the menu variant hook; its title center differs from the ribbon center by less than 6 CSS pixels; the backdrop or scrim's computed color has alpha 1; sampled pixels outside the card are black; and no home content is visible.
- Covers AE3. The in-game settings root exposes the in-game variant hook and does not match the opaque menu selector; the pause screenshot retains the dimmed gameplay scene.
- Dismissing either variant still invokes the existing cleanup and callback paths.

**Verification:** Built-dist `settings` and `pause` screenshots show the two backdrop treatments and preserve modal interaction hooks; computed geometry confirms title-to-ribbon centering.

### U3. Capture MRV2-15 evidence and run close-out gates

**Goal:** Produce durable, card-specific proof for every fix without overwriting earlier wave evidence.

**Requirements:** R1-R5; AE1-AE3.

**Dependencies:** U1, U2.

**Files:** Create `games/marble_run/scripts/verify-wave8.mjs`; create PNG evidence under `games/marble_run/evidence/mrv2-15/`.

**Approach:** Adapt `games/marble_run/scripts/verify-wave7.mjs` to capture `home-fresh`, `settings`, and `pause` from a built dist at 390×844. Assert at least 16 CSS pixels of sun/CTA clearance and less than 6 CSS pixels of title/ribbon center deviation. For opacity, assert the menu variant hook and that the computed backdrop or scrim color resolves to alpha 1; assert the in-game variant does not match that opaque rule. Retain multi-region screenshot sampling only as composited visual evidence. Capture quick guard images for accepted states touched by shared selectors and compare generated images directly with the card's Round-7 references before handoff.

**Execution note:** Wait on published tour-state markers rather than fixed sleeps for state acquisition. A short post-marker render settle is acceptable before sampling.

**Patterns to follow:** `games/marble_run/scripts/verify-wave7.mjs` and its `games/marble_run/evidence/mrv2-14/` output convention.

**Test scenarios:**

- Headless verifier fails when sun clearance is below 16 CSS pixels at 390×844 or overlaps at the 390×780 responsive guard.
- Headless verifier fails when title-to-ribbon center deviation is 6 CSS pixels or more.
- Headless verifier fails when the menu backdrop's computed alpha is below 1, the menu variant hook is missing, or the in-game variant matches the opaque menu rule.
- Each state writes a uniquely named PNG under the MRV2-15 evidence directory.

**Verification:** The verifier exits successfully and the implementer visually inspects every generated PNG beside its authoritative Round-7 reference. Typecheck, unit tests, and game-scoped ESLint all pass. A real iPhone WKWebView or Android WebView capture confirms the final visual behavior; if device access is unavailable, handoff must state that device parity remains unverified.

---

## Verification Contract

Run from the repository root:

```bash
npm --prefix games/marble_run run build
npm --prefix games/marble_run run typecheck
npm --prefix games/marble_run run test:unit
npm --prefix games/marble_run run lint
```

Run the card-specific verifier from `games/marble_run` after the build:

```bash
node scripts/verify-wave8.mjs
```

Required headless observations at 390×844:

- `evidence/mrv2-15/home-fresh.png`: complete sun node and numeral with at least 16 CSS pixels of clearance above LEVEL 1.
- `evidence/mrv2-15/settings.png`: SETTINGS title centered within 6 CSS pixels of the ribbon center, computed backdrop alpha 1, and opaque black outside the card.
- `evidence/mrv2-15/pause.png`: title remains centered and gameplay remains visible through the accepted dim scrim.

Final visual acceptance also requires an on-device capture because the target is a mobile WebView. Do not report the headless lane as device verification.

---

## Definition of Done

- All three card defects satisfy their acceptance examples.
- Implementation changes remain under `games/marble_run/**`; `packages/ui/**` is unchanged.
- Build, typecheck, unit tests, and game-scoped ESLint pass.
- The MRV2-15 headless verifier passes and its screenshots have been visually compared with the Round-7 references.
- The affected states have been observed on a real target device, or the handoff explicitly marks device parity unverified and leaves that gate to the conductor.
- Pause, level-map, gameplay, and win retain their accepted behavior wherever the changed selectors can affect them.
- No dead-end CSS, temporary diagnostics, overwritten historical evidence, pull request, or unrelated cleanup remains.
