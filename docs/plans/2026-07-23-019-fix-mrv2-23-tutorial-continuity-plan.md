---
title: "fix: MRV2-23 tutorial continuity and home stacking"
date: 2026-07-23
type: fix
origin: trello-card-Xohsb3qa (card description; no brainstorm document)
trello: https://trello.com/c/Xohsb3qa
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: MRV2-23 tutorial continuity and home stacking

## Goal Capsule

Restore three device-visible Marble Run v1 presentation contracts: the level-one tutorial route is one continuous solid blue path, the tutorial target is presented with the v1 hand and a light local spotlight instead of a persistent dark screen scrim, and the wooden home banner remains above the rotating board while the board remains above the saga rail.

The Trello card and live v1 device captures are the visual authority. Source changes are limited to `games/marble_run/**`; no shared `packages/ui` edits, new speculative art, gameplay-rule changes, pull request, or source-tree build/capture output is authorized.

---

## Product Contract

### Summary

The current route renderer deliberately alternates white and route-color beam segments and adds white markers, which produces the reported broken white sections. The current tutorial HUD creates only a target container while CSS applies a full-screen dark purple background, so the target has neither a hand nor a light local emphasis. The home preview canvas is explicitly raised above the shell content to cover the saga rail, but the game-owned banner has no explicit stacking level within that hierarchy.

### Requirements

- R1. On the first-play tutorial, the route from the target marble through every turn to its gate renders as one continuous solid blue connected path with no white segments, gaps, or white joint markers.
- R2. The first-play tutorial shows the same hand presentation as live v1, positioned from the existing projected tutorial target, and uses a light local spotlight without a persistent full-screen dark scrim.
- R3. Tutorial input remains non-blocking and preserves the existing first-level-only lifecycle, route preview, rejection feedback, and cleanup behavior.
- R4. On home, the wooden title banner always paints above the rotating board; the rotating board paints above the saga rail. The LEVEL button and current saga node retain their established interactive stacking.
- R5. Each corrected item is proven with live v1 and v2 real-device captures shown side by side, followed by the conductor's Pixelsmith judgment.

### Acceptance Examples

- AE1. Given a pristine save driven to `gameplay-teach`, when the route preview settles on a real device, then the blue guide reads as one uninterrupted connected line from the marble to the gate and contains no white sections.
- AE2. Given the same tutorial state, when it is compared with live v1, then the hand is visible at the target, the target area is lightly emphasized, and the remainder of the board and HUD are not covered by the current dark purple scrim.
- AE3. Given home with the decorative board turning through the banner region, when several rotations are observed, then the banner remains visually above the board while the saga rail remains behind the board.
- AE4. Given the implementation-stage evidence set, when each v2 capture is paired with its contemporaneous live v1 capture, then the line, tutorial presentation, and home z-order can each be judged independently by Pixelsmith.

### Scope Boundaries

- Keep all runtime and test edits under `games/marble_run/**`; do not change `packages/ui`.
- Do not alter route solving, path selection, board interaction, tutorial eligibility, progress persistence, or home navigation.
- Reuse checked-in presentation assets and patterns. Do not generate or substitute new hand art.
- Store builds, DerivedData, captures, diffs, and judge inputs under `$TWF_OUT_DIR`, never in the source worktree.
- Browser rendering and simulators are not acceptance evidence for this mobile game. They may support code diagnosis only when explicitly needed; real iPhone WKWebView or Android WebView captures are required.

### Product Contract Preservation

Product Contract unchanged from the Trello card. The plan makes the requested v1 comparison and conductor Pixelsmith judgment explicit per defect and preserves the card's source and verification boundaries.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Replace the segmented route decoration in `games/marble_run/src/three/BoardScene.ts` with one continuous route-colored geometry whose turns share endpoints. The existing `THREE.Line` alone is not a reliable device-visible solution because line width is platform-limited; use connected solid geometry with route-color joins/caps and no alternating white material or white marker layer.
- KTD2. Keep `GameplayController` as the owner of tutorial target projection and lifecycle. Restore the presentation inside `GameplayHud.showTutorialHand` and `games/marble_run/src/gameplay/hud.css` so no parallel tutorial state machine is introduced.
- KTD3. Reuse the local spotlight-hole pattern already implemented by `games/marble_run/src/ui/TutorialOverlay.ts` and `games/marble_run/src/ui/styles.css`: dim outside a bounded target while leaving the target bright. Adapt it to the gameplay tutorial layer without importing the unrelated multi-step overlay flow.
- KTD4. Resolve the card's claimed existing vida hand art against the tracked asset inventory and live v1 by content and provenance before wiring it. The current tree contains vida HUD assets and the spotlight implementation, but no tracked filename identifies a tutorial-hand raster; if the exact existing asset cannot be substantiated, stop and return the card with that evidence instead of inventing or generating art.
- KTD5. Express the home hierarchy with explicit game-owned stacking contexts: banner above preview canvas above saga rail. Preserve the already-pinned LEVEL/current-node levels and avoid changing generic shared-kit defaults.
- KTD6. Treat device evidence as three independent convergence loops. Capture live v1 and v2 from equivalent states and crop/compose side-by-side comparisons per item so a pass in one area cannot conceal a failure in another.

### Patterns and Constraints

- Follow `games/marble_run/src/three/BoardScene.ts` for route-preview lifetime, animation ownership, material disposal, and `routeKind` metadata.
- Follow `games/marble_run/src/gameplay/GameplayController.ts` for first-level eligibility, target projection, rejection animation, and tutorial cleanup.
- Follow `games/marble_run/src/ui/TutorialOverlay.ts` plus its `.tutorial-spotlight` rule in `games/marble_run/src/ui/styles.css` for a bright target cutout with pointer events passing through.
- Follow the ID-strength preview selector and existing z-index pins in `games/marble_run/design/theme.ts`; add a narrow Marble Run selector rather than widening shared shell rules.
- Follow `games/marble_run/src/testing/pixelsmithStates.ts` and `games/marble_run/src/testing/TestHarness.ts` for deterministic `gameplay-teach` state preparation, while using `tools/verify-device` for final runtime proof.

### Assumptions

- Live v1 comparison will determine the exact hand asset, scale, offset, animation phase, spotlight radius, and route-blue tone; these are visual tuning values, not new product decisions.
- The continuous route may retain a subtle route-color pulse if live v1 shows motion, but it must never change hue to white or expose gaps.
- The banner can be raised within the existing home stacking context without moving its layout or affecting coin, gear, LEVEL, or current-node interaction.

### Sequencing

First characterize and correct the route renderer, because it is independent of DOM stacking. Next restore the tutorial hand/spotlight using the existing target lifecycle and verified asset. Finally make the home stacking hierarchy explicit and verify it across board rotation. Run the code-health gates after all three units, then collect independent live device comparisons and submit them to the conductor's Pixelsmith judge.

---

## Implementation Units

### U1. Render one continuous tutorial route

**Goal:** Remove the white/gapped segmented decoration and render a connected solid blue route through every path turn.

**Requirements:** R1, R3, R5; AE1, AE4.

**Dependencies:** None.

**Files:** Modify `games/marble_run/src/three/BoardScene.ts`; add focused coverage in `games/marble_run/tests/unit/board-scene-route-preview.test.ts` or the nearest existing BoardScene test file; inspect `games/marble_run/src/gameplay/GameplayController.ts` as the route-preview caller.

**Approach:** Build the visible guide from the complete ordered `routePoints` list using continuous route-colored geometry. Ensure adjacent spans meet or overlap at turns and terminate cleanly at the gate. Remove the alternating `0xffffff` beam colors and white torus markers that currently create visible white sections. Preserve route-preview clearing, material disposal, hint pulse, animation ticking, and blocked-route support.

**Execution note:** Start with a focused renderer characterization that inspects the constructed preview graph/materials before changing the geometry; the decisive visual check remains the real-device capture.

**Patterns to follow:** `showRoutePreview`, `showBlockedRoutePreview`, `showRoutePoints`, `clearRoutePreview`, and the `routeKind` animation branch in `games/marble_run/src/three/BoardScene.ts`.

**Test scenarios:**

- Covers AE1. Given a multi-turn route preview, every visible route span and join uses the route blue and no preview material uses white.
- Given adjacent horizontal/vertical route spans, their constructed endpoints meet without a gap and include turn coverage.
- Given a blocked-route preview, it uses the same continuous solid-color renderer and remains clearable.
- Given repeated show/clear cycles, the prior geometry and cloned materials are removed/disposed and only one preview remains.

**Verification:** Focused renderer tests prove one color and connected ordered spans; a real-device `gameplay-teach` capture beside live v1 proves the rendered path has no white sections or visible gaps.

### U2. Restore the v1 hand and light spotlight

**Goal:** Show the verified existing v1 hand at the projected tutorial target and replace the persistent dark screen scrim with the v1 light local emphasis.

**Requirements:** R2, R3, R5; AE2, AE4.

**Dependencies:** U1.

**Files:** Modify `games/marble_run/src/gameplay/hud.ts` and `games/marble_run/src/gameplay/hud.css`; update `games/marble_run/tests/unit/gameplay-hud.test.ts`; inspect `games/marble_run/src/ui/TutorialOverlay.ts`, `games/marble_run/src/ui/styles.css`, `games/marble_run/docs/asset-manifest.json`, and the verified hand asset under `games/marble_run/public/**`; update the asset manifest test only if the verified existing asset is present but not yet inventoried.

**Approach:** Keep the existing `--tx`/`--ty` target coordinates and non-interactive full-screen container. Add the verified hand image and a bounded spotlight/cutout centered on that target. Remove the layer's opaque purple background; if v1 dims outside the target, reproduce that with the existing large-shadow cutout pattern so the target and hand remain bright. Scope animations to transform/opacity on the hand or spotlight, retain rejection feedback, and ensure disposal removes the complete layer.

**Execution note:** Asset provenance is a hard precondition. Compare the tracked vida inventory and live v1 before wiring the image; block if the card's claimed exact asset is not actually available in the scoped tree.

**Patterns to follow:** `GameplayHud.showTutorialHand`, `.tutorial-hand-layer`, `TutorialOverlay.setCircleSpotlight`, and `.tutorial-spotlight` in `games/marble_run/src/ui/styles.css`.

**Test scenarios:**

- Covers AE2. `showTutorialHand` creates a hand image and spotlight anchored by `--tx`/`--ty`, and the layer itself has no full-screen opaque/dark background.
- The hand image source resolves to the verified checked-in asset and includes non-dragging/decorative semantics.
- The tutorial layer remains pointer-transparent so tapping the highlighted marble reaches the board.
- Rejection feedback animates the restored hand/spotlight without leaving stale classes or duplicate layers.
- Removing or disposing the tutorial removes the hand, spotlight, and any presentation state.

**Verification:** Unit coverage pins the DOM, asset, pointer, and cleanup contracts; a real-device `gameplay-teach` capture beside live v1 proves the hand is visible and the target is lightly emphasized without the current persistent dark sheen.

### U3. Pin banner-over-board-over-saga stacking

**Goal:** Make the wooden title banner stay above the rotating preview board while the preview board continues to cover the saga rail.

**Requirements:** R4, R5; AE3, AE4.

**Dependencies:** None.

**Files:** Modify `games/marble_run/design/theme.ts`; update `games/marble_run/tests/unit/device-parity-wave6.test.ts` or add `games/marble_run/tests/unit/device-parity-mrv2-23.test.ts`; inspect `games/marble_run/src/menu/homeMenu.ts` and `games/marble_run/src/menu/HomeBoardPreview.ts`.

**Approach:** Assign the game-owned `.marble-home-banner` (including its image/title) an explicit positioned stacking level above `#hud-overlay > .marble-home-board-preview`. Keep the preview above the shell/saga layer and leave the established LEVEL button and current-node z-indices unchanged. Avoid creating a stacking context on a shared ancestor that would trap the banner below the fixed canvas.

**Execution note:** Observe several seconds of real-device board rotation; a single static frame may miss the overlap defect.

**Patterns to follow:** The explicit preview rule and LEVEL/current-node pins already in `games/marble_run/design/theme.ts`, plus the banner ownership in `games/marble_run/src/menu/homeMenu.ts`.

**Test scenarios:**

- Covers AE3. The banner selector has a positioned z-index greater than the preview canvas, and the preview canvas remains greater than the saga content layer.
- The LEVEL button and current node retain their existing higher interactive stacking values.
- Home banner layout, title alignment, coin pill, gear, and pointer behavior remain unchanged.

**Verification:** CSS contract coverage pins the intended hierarchy; a real-device home recording or multiple captures through board rotation beside live v1 prove banner > board > saga throughout the motion.

### U4. Complete code-health and per-item device evidence

**Goal:** Prove the three fixes independently on the real mobile target and package durable inputs for the conductor's Pixelsmith decision.

**Requirements:** R5; AE1, AE2, AE3, AE4.

**Dependencies:** U1, U2, U3.

**Files:** No source file is expected beyond fixes required by the gates; place all disposable builds, captures, crops, comparisons, and judge inputs under `$TWF_OUT_DIR`.

**Approach:** Run Marble Run typecheck, unit tests, and game-scoped ESLint. Install/launch the actual iOS WKWebView or Android WebView build and drive a pristine save to `gameplay-teach` plus home. Capture live v1 and v2 from equivalent device states. Produce three labeled side-by-side comparisons: route continuity, hand/spotlight, and banner rotation z-order. Hand those exact artifacts to the conductor for Pixelsmith judgment; do not self-substitute a browser screenshot or general visual claim.

**Execution note:** Device-first proof is mandatory. If device access or live v1 capture is unavailable, report the exact missing gate rather than calling the card complete.

**Patterns to follow:** `games/marble_run/src/testing/pixelsmithStates.ts`, `games/marble_run/src/testing/TestHarness.ts`, `tools/verify-device/README.md`, and the repo's existing Marble Run evidence naming conventions.

**Test scenarios:**

- Covers AE1. The v2 tutorial route comparison shows solid continuous blue at every segment and join.
- Covers AE2. The v2 tutorial comparison shows the verified hand and light local emphasis with no persistent dark full-screen scrim.
- Covers AE3. Multiple home frames show the banner above every rotated-board overlap and the board above the saga rail.
- Covers AE4. Each comparison pairs contemporaneous v1/v2 device captures, names device/build/state metadata, and receives a conductor Pixelsmith verdict.

**Verification:** Typecheck, unit tests, and ESLint are green; all three side-by-side device comparisons are visually inspected; the handoff names their `$TWF_OUT_DIR` paths and the conductor's Pixelsmith result.

---

## Verification Contract

Run the Marble Run typecheck, unit suite, and game-scoped ESLint after implementation. Focused tests must cover the route-preview geometry/material contract, tutorial DOM/asset/cleanup contract, and explicit home stacking hierarchy.

Final verification must run on a real iPhone WKWebView or Android WebView. Use a pristine save for `gameplay-teach`, and observe home across enough board rotation to exercise the overlap. For each of the three defects, capture live v1 and v2 from matching states, create a labeled side-by-side comparison under `$TWF_OUT_DIR`, and have the conductor run Pixelsmith on that comparison.

Browser E2E, Playwright screenshots, simulator renders, builds, or unit tests do not prove mobile visual parity. If any real-device comparison or conductor judgment is missing, name it as remaining work.

---

## Risks and Dependencies

- The card states that exact vida hand art exists in the ported tree, while the current tracked inventory exposes no clearly named tutorial-hand raster. U2 must resolve this by content/provenance before implementation; missing art is a blocker, not permission to generate a substitute.
- Three.js line width and anti-aliasing differ across mobile WebViews. Connected solid geometry is preferred over relying on `LineBasicMaterial.linewidth`, and device capture is required to catch seams.
- CSS z-index values do not compare across independent stacking contexts. The banner fix must be validated against the actual DOM ancestors as well as by CSS-string coverage.
- Live v1 availability and conductor Pixelsmith access are external verification dependencies owned by the implementation/conductor stages.

---

## Definition of Done

- The level-one tutorial route is an uninterrupted solid blue connected path with no white sections or join gaps on a real device.
- The verified existing v1 hand is visible at the tutorial target with light local emphasis; the current persistent dark full-screen scrim is gone.
- Tutorial eligibility, projection, input pass-through, rejection feedback, route preview, and cleanup still behave as before.
- The home wooden banner remains above the rotating board through motion, and the board remains above the saga rail without regressing LEVEL/current-node interaction.
- Marble Run typecheck, unit tests, and game-scoped ESLint are green.
- Three item-specific live v1/v2 side-by-side device comparisons exist under `$TWF_OUT_DIR`, and the conductor's Pixelsmith judgment is recorded for each.
- No change touches `packages/ui`, gameplay rules, unrelated games, or unrequested shell behavior; no pull request is opened.
