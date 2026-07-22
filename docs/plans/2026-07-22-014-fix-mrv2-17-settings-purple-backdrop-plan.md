---
title: "fix: MRV2-17 settings purple backdrop"
date: 2026-07-22
type: fix
origin: trello-card-clTY1WqI (card description; no brainstorm document)
trello: https://trello.com/c/clTY1WqI
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-17 settings purple backdrop

## Goal Capsule

Replace the menu-settings backdrop's Wave-8 flat black with the reference's fully opaque, dark desaturated-purple marble-bubble field. Preserve the accepted modal, home, pause, and gameplay behavior. Work stays under `games/marble_run/**`; no pull request or `packages/ui` edit is in scope.

The Trello card and `games/marble_run/refs/captures/android-basegamelab/settings.png` are the visual authority. The implementation worker owns code, tests, headless comparison evidence, and honest device verification. The TWF conductor owns landing.

## Product Contract

### Summary

The menu settings surface currently replaces the home scene with solid black. The reference instead uses a dark purple field whose faint repeating marble bubbles remain visible behind the modal while the underlying home UI does not read through.

### Requirements

- R1. The menu-settings backdrop renders as a dark desaturated purple field close to the reference's roughly `#3b3247` tone.
- R2. The menu-settings backdrop retains a subtle repeating marble-bubble texture without exposing recognizable home UI beneath it.
- R3. The backdrop remains fully opaque as a composited surface.
- R4. The in-game settings backdrop retains its accepted translucent gameplay scrim.
- R5. Home, pause, and gameplay retain their Round-8 CLEAN state.

### Acceptance Examples

- AE1. Given the home menu, when settings opens, then pixels outside the modal are purple-dominant and show faint marble bubbles rather than flat black or readable home UI.
- AE2. Given active gameplay, when in-game settings opens, then the existing dimmed gameplay treatment remains unchanged.

### Scope Boundaries

- Modify only `games/marble_run/**` plus this plan artifact.
- Do not edit `packages/ui`, change modal structure or interactions, or retune already accepted settings-card geometry.
- Treat the card-specific headless comparison as required diagnostic evidence, not as a substitute for the real-device target.

### Product Contract Preservation

Product Contract unchanged from the Trello card.

## Planning Contract

### Key Technical Decisions

- KTD1. Compose the menu-only backdrop from a solid dark-purple base, the existing `/v1/ui/marble-shadow-tile.png` repeat, and a heavy dark overlay. Keep the selector fully opaque and independent of the home surface so recognizable home elements cannot bleed through.
- KTD2. Reuse the established shell bubble asset and tile sizing from `games/marble_run/design/theme.ts`, but reduce its contrast to match the reference. Do not add an asset or shared-kit API.
- KTD3. Make the Wave-8 verifier assert semantic color properties: alpha is 1, blue exceeds red, red remains above a near-black floor, and the result is not `rgb(0, 0, 0)`. Preserve the in-game translucency assertion.
- KTD4. Update the game-local CSS regression pin so it verifies the purple layered background and continues to reject an opaque treatment on the in-game variant.
- KTD5. Route generated verifier screenshots through `$TWF_OUT_DIR` instead of writing disposable evidence into the source worktree.

### Patterns and Constraints

- Follow the existing purple bubble world layers near the top of `games/marble_run/design/theme.ts` and keep the override scoped to `.fab-ui.fab-modal-backdrop.marble-settings-modal--menu`.
- Follow `games/marble_run/scripts/verify-wave8.mjs` for the harness-enabled build, preview lifecycle, tour-state acquisition, and capture path.
- Use `games/marble_run/tests/unit/device-parity-wave8.test.ts` for the cheap CSS contract.
- Real-device WebView rendering remains authoritative. The required headless screenshot is a comparison aid only.

### Sequencing

Update the scoped style and its unit pin together, then revise the verifier's computed-color expectation. Run the card-specific capture and quality gates before comparing the generated settings image with the reference.

## Implementation Units

### U1. Restore the opaque purple bubble field

**Goal:** Make menu settings visually match the reference backdrop while leaving in-game settings unchanged.

**Requirements:** R1-R5; AE1, AE2.

**Dependencies:** None.

**Files:** Modify `games/marble_run/design/theme.ts`; test `games/marble_run/tests/unit/device-parity-wave8.test.ts`.

**Approach:** Replace the menu selector's solid black with layered purple backgrounds that include the existing repeating marble-shadow tile and a heavy darkening layer. Ensure the selector paints an opaque base color, keeps the bubbles faint, and does not style `.marble-settings-modal--ingame`.

**Execution note:** Start with the CSS pin, then tune the visual layer against the reference screenshot; the screenshot is the evidence for contrast and texture.

**Patterns to follow:** The body and `.marble-ui::before` bubble layers in `games/marble_run/design/theme.ts`.

**Test scenarios:**

- Covers AE1. The menu-only CSS rule contains an opaque purple base and the repeating marble tile, and no longer contains `background: #000`.
- Covers AE2. No in-game settings selector receives the opaque purple background layers.

**Verification:** The computed menu backdrop is opaque and purple-dominant, and a screenshot shows faint bubbles without legible home UI.

### U2. Align Wave-8 verification with the reference

**Goal:** Make the existing acceptance script reject flat black while retaining opacity and variant regression coverage.

**Requirements:** R1-R5; AE1, AE2.

**Dependencies:** U1.

**Files:** Modify `games/marble_run/scripts/verify-wave8.mjs`; generate disposable capture output under `$TWF_OUT_DIR`.

**Approach:** Parse the computed backdrop color channels and require full opacity, purple dominance, and a non-black channel floor. Keep the menu/in-game hook checks and the in-game alpha check unchanged. Make the evidence directory derive from `$TWF_OUT_DIR`. Build through the script's existing `VITE_ENABLE_TEST_HARNESS=true` path.

**Execution note:** Compare the produced `settings.png` directly beside `games/marble_run/refs/captures/android-basegamelab/settings.png`; computed color alone cannot prove the bubble texture or absence of home read-through.

**Patterns to follow:** Existing result collection, failure reporting, and settings/pause branching in `games/marble_run/scripts/verify-wave8.mjs`.

**Test scenarios:**

- The verifier passes for an opaque dark-purple backdrop whose blue channel exceeds red and whose red channel is above the near-black floor.
- The verifier fails for `rgb(0, 0, 0)`, a non-purple opaque color, or any backdrop with alpha below 1.
- The pause state still passes only when the in-game hook is present and its backdrop remains translucent.

**Verification:** `verify-wave8.mjs` exits with `RESULT: PASS`, writes its expected screenshots, and the settings capture visually matches the reference's field color and bubble subtlety.

## Verification Contract

Run from the repository root:

```bash
npm --prefix games/marble_run run typecheck
npm --prefix games/marble_run run test:unit
npm --prefix games/marble_run run lint
```

Run from `games/marble_run`:

```bash
node scripts/verify-wave8.mjs
```

The verifier must build with `VITE_ENABLE_TEST_HARNESS=true` through its existing build step and finish with `RESULT: PASS`. Compare its generated settings screenshot directly with `games/marble_run/refs/captures/android-basegamelab/settings.png`, checking the outer field's hue, bubble visibility, and lack of recognizable home UI. Final visual acceptance remains device-first; if no real device capture is possible in the implementation stage, the handoff must say so.

## Definition of Done

- Menu settings shows an opaque dark-purple field with faint repeating marble bubbles and no readable home UI.
- In-game settings remains translucent and all previously CLEAN states remain unchanged.
- `verify-wave8.mjs` passes after its harness-enabled build, and its settings screenshot has been visually compared with the reference.
- Typecheck, unit tests, and ESLint pass for `games/marble_run`.
- Changes remain under `games/marble_run/**` plus this plan; `packages/ui/**` is unchanged.
- No temporary diagnostics, dead-end CSS, unrelated cleanup, or pull request remains.
