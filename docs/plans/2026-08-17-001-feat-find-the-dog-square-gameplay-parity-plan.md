---
title: "Find the Dog square gameplay parity"
created_at: 2026-08-17
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Find the Dog square gameplay parity

## Goal Capsule

- **Objective:** Port Find the Bird's five selected square-level interaction improvements into Find the Dog: cover-fit panning, adaptive hitboxes, viewport-aware hints, viewport-aware tutorial targeting, and restricted zoom with short pan inertia.
- **Authority:** This plan and the user's five-item selection govern scope. Existing Find the Dog behavior remains authoritative outside square navigation, targeting, hints, and tutorial placement.
- **Execution profile:** Dog-only surgical port. Reuse the corresponding Bird helpers and tests where their behavior is generic, adapting species copy and preserving Dog rules.
- **Stop conditions:** Stop if implementation would change Dog's three-life failure loop, hint balance rules, achievements, economy, progression order, level content, reveal mechanics, or non-square section navigation.
- **Tail ownership:** Completion requires automated regression coverage plus current-build physical-device gameplay evidence on representative square and non-square levels.

---

## Product Contract

### Summary

Find the Dog retains its existing game identity and punitive three-life loop while adopting the interaction improvements that make square levels in Find the Bird easier to navigate and fairer to tap. The port applies to continuous square levels; sectioned and ordinary non-square levels retain their established behavior unless a shared helper must remain safe for them.

### Problem Frame

Find the Dog currently contains square scenes inside the viewport with mirrored margins, accepts authored hit radius multiplied by a global tolerance, selects hints uniformly from all remaining dogs, anchors the first tutorial to `dogs[0]`, permits panning only after zoom, and allows zoom up to 2.5x. These behaviors can expose artificial borders, make small or clustered dogs frustrating to tap, direct players away from the visible area, point the tutorial at off-screen scenery, and let players become lost in an excessively tight crop.

The equivalent Bird implementation already contains small geometry modules and focused tests for cover fit, square hit targets, and inertia. Those modules are the primary reference. `games/find_the_bird/src/scenes/GameScene.ts` is not a wholesale port source because it also contains unrelated Bird product behavior.

### Requirements

**Square layout and navigation**

- R1. A continuous square Dog level must fill the portrait viewport without mirrored letterbox scenery.
- R2. The initial square-level crop must be centered, and every cropped artwork edge must remain reachable through bounded one-finger panning at minimum zoom.
- R3. Square-level panning must never expose background outside the rendered artwork.
- R4. Square-level panning must retain short decaying inertia, stop at artwork bounds, and settle without indefinite drift.
- R5. Continuous square levels must use a 1.75x maximum pinch zoom while preserving the existing focal-point behavior and 1.0x minimum; non-square and sectioned levels retain Dog's current 2.5x ceiling.

**Target interaction**

- R6. Square levels must enforce a dimension-scaled minimum tap radius for tiny dogs.
- R7. Nearby square targets must remain resolvable by nearest center; adaptive tolerance must avoid making a neighboring dog the preferred result for a tap closer to the intended dog.
- R8. Non-square target tolerance must remain the existing authored radius multiplied by `GAMEPLAY.TOLERANCE_MULTIPLIER`.

**Hints and tutorial**

- R9. On a continuous square level, a normal hint must prefer a randomly selected visible unfound dog; when none is visible, it must select the nearest unfound dog outside the current viewport. Other layouts retain Dog's existing random selection.
- R10. An off-screen hinted dog must produce a viewport-edge direction indicator that tracks camera movement and disappears when the hint ends, the target becomes visible, the target is found, or the scene shuts down.
- R11. On a continuous square level, the first-time tutorial must target the unfound dog nearest the current viewport center among safely visible candidates rather than assuming `dogs[0]`. Other layouts retain the existing `dogs[0]` behavior.
- R12. When no dog is initially visible, the tutorial must pan to the nearest candidate before presenting the existing Dog tutorial.
- R13. Dog's tutorial hint remains free/suppressed and continues directly to its existing zoom lesson; Bird's real-hint and wait-for-hinted-target sequence is explicitly excluded.

**Regression boundaries**

- R14. Sectioned wide levels retain their existing `SectionController` behavior and do not gain minimum-zoom free panning.
- R15. Dog's lives, failure offers, rewards, achievements, hint caps, progression, reveal/dissolve behavior, audio, haptics, copy, level art, and existing gameplay art remain unchanged. A minimal Dog-owned hint edge-indicator asset is allowed only when no existing Dog/shared asset satisfies R10.
- R16. Existing human-authored level coordinates and hitbox data must not be rewritten as part of this runtime port.

### Key Flows

- F1. Square-level entry
  - **Trigger:** A continuous square level finishes loading.
  - **Steps:** Resolve cover scale, render at world origin, center the initial camera crop, establish artwork-only camera bounds, and enable panning at 1.0x.
  - **Outcome:** The level is full-bleed and all cropped content is reachable without exposing gutters.
  - **Covered by:** R1-R5, R14.
- F2. Square target tap
  - **Trigger:** The player releases a valid tap inside the level artwork.
  - **Steps:** Resolve each eligible dog's adaptive square radius, collect eligible hits, and select the closest center using the existing closest-target path.
  - **Outcome:** Tiny dogs remain tappable and close pairs resolve predictably.
  - **Covered by:** R6-R8, R16.
- F3. Hint request
  - **Trigger:** The player uses a normal paid hint outside the tutorial suppression step.
  - **Steps:** Prefer visible candidates; otherwise choose the closest off-screen candidate, render the normal Dog hint pulse using its runtime radius, and show a tracking edge indicator while necessary.
  - **Outcome:** The hint points somewhere relevant and provides navigation when the dog is outside the crop.
  - **Covered by:** R9-R10, R13, R15.
- F4. First-time tutorial
  - **Trigger:** The first-time tutorial begins on a square level.
  - **Steps:** Choose the nearest safely visible candidate or pan to the nearest candidate, then run the existing Dog tutorial state machine against that exact dog ID.
  - **Outcome:** The spotlight and allowed tap refer to the same visible dog; hint and zoom teaching remain Dog-specific.
  - **Covered by:** R11-R13.

### Acceptance Examples

- AE1. Given a 4096x4096 level in the portrait viewport, when gameplay begins, then the artwork fills the viewport, the crop starts centered, and dragging at 1.0x reaches both horizontal edges without revealing a gutter.
- AE2. Given two small nearby dogs in a square scene, when a tap falls inside both tolerance regions but closer to dog B, then dog B is collected.
- AE3. Given at least one visible and one off-screen unfound dog, when a hint is used, then the chosen target is from the visible set and no edge indicator is required.
- AE4. Given no unfound dog is visible, when a hint is used, then the nearest off-screen dog is selected and the edge indicator points toward it until it enters the viewport or the hint terminates.
- AE5. Given `dogs[0]` is outside the initial crop but another dog is safely visible, when the first tutorial opens, then the visible dog is highlighted and only that dog's tap advances the tutorial.
- AE6. Given a wide sectioned level, when the player drags at 1.0x, then free continuous panning is not introduced and section transitions work as before.

### Scope Boundaries

- No achievements, daily streaks, reward claiming, hint-cap, wallet, shop, ad, IAP, health-bar, or failure-loop changes.
- No Bird pickup-style selector, feather effects, Bird UI assets, Bird copy, or Bird analytics vocabulary.
- No level regeneration, coordinate changes, hitbox migration, manifest edits, or catalog reordering.
- No broad synchronization of `GameScene.ts`; only the selected interaction paths and their minimal helper dependencies are in scope.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Copy the generic Bird geometry modules into Dog-local modules rather than importing across game packages. The games are deployable workspaces with independent source trees; a cross-game runtime dependency would couple releases and make reskin ownership unclear.
- KTD2. Define one exported Dog-local predicate, `isContinuousSquareLevel(level)`, whose contract is exact equal artwork dimensions and no non-empty `sections` array. Use it for cover fit, minimum-zoom panning, adaptive hit geometry, viewport-aware hints, viewport-aware tutorial targeting, and the square zoom ceiling. Sectioned levels remain governed by `SectionController` even if their raw dimensions happen to be square.
- KTD3. Keep the cover-fit image at non-negative world origin and center through camera scroll. This preserves reveal canvases, image-to-level coordinate conversion, and target positions without rewriting content.
- KTD4. Reuse the existing closest-unfound-target selection after substituting adaptive radii. Nearest-center resolution is the deterministic tie-breaker for overlapping minimum-radius floors.
- KTD5. Keep hint candidate selection and edge-arrow lifecycle inside `GameScene` for this port. Extracting a new shared hint service would widen scope without an existing cross-game abstraction.
- KTD6. Preserve Dog's tutorial state machine. Port only candidate selection, target-ID gating, camera-aware anchor updates if required, and the fallback pan; do not port Bird's real tutorial hint behavior.
- KTD7. Add an optional maximum-zoom override to `PinchZoom`: square continuous levels pass 1.75x, while all other Dog layouts keep the existing 2.5x default. Minimum-zoom panning and inertia are enabled through the same square-only scene option.
- KTD8. Use Bird's established visibility geometry rather than inventing a second UX rule: a candidate is visible when its world-space center is inside `camera.worldView` inset by 60 world pixels on every side. Hints and tutorials use the same inset; the tutorial fallback pan handles the no-candidate case.
- KTD9. Match Bird's edge-indicator semantics: clamp a fixed 150x150 screen-space hand to x=86..width-86 and y=120..height-140; horizontal flip communicates left versus right, while its clamped perimeter position communicates vertical/diagonal direction. The indicator does not rotate.

### Existing Patterns to Follow

- Cover geometry: `games/find_the_bird/src/scenes/levelFit.ts` and `games/find_the_bird/tests/unit/level-fit.test.ts`.
- Adaptive hit geometry: `games/find_the_bird/src/scenes/hitboxGeometry.ts` and `games/find_the_bird/tests/unit/hitbox-geometry.test.ts`.
- Optional minimum-zoom panning and inertia: `games/find_the_bird/src/scenes/PinchZoom.ts` and `games/find_the_bird/tests/unit/pinch-zoom-inertia.test.ts`.
- Bird integration reference, selectively: `games/find_the_bird/src/scenes/GameScene.ts` cover-fit, camera-bounds, hit-selection, hint-selection, edge-indicator, and tutorial-candidate paths.
- Dog behavioral authority: `games/find_the_dog/src/scenes/GameScene.ts`, `games/find_the_dog/src/scenes/PinchZoom.ts`, `games/find_the_dog/src/ui/TutorialOverlay.ts`, and `games/find_the_dog/src/scenes/SectionController.ts`.

### Sequencing

1. Characterize Dog's current square/non-square behavior and add failing helper tests.
2. Land pure cover-fit, hit-radius, and inertia helpers with their unit coverage.
3. Integrate cover-fit, camera bounds, adaptive hit testing, zoom, and optional panning into Dog gameplay.
4. Integrate viewport-aware hints and tutorial targeting while retaining Dog's tutorial hint semantics.
5. Run automated regression gates, then build/install/launch and visually exercise representative square and sectioned levels on the connected phone.

### Assumptions and Risks

- Bird's minimum base radius of 57 at a 2688 reference dimension is treated as the selected known-good starting value, not recalibrated during this port.
- Find the Dog has two distinct catalogs. The editor Gallery currently exposes 81 active authoring cards/sessions, all square: 80 at 2688x2688 and one at 4096x4096. The published runtime/CDN catalog separately contains 54 continuous 2560x5600 portrait levels. The 81 real Gallery packages are the square acceptance corpus; the 54 published packages remain the adjacent production-regression corpus. This port must not silently publish, reorder, or mutate either catalog.
- The checkout is shared and dirty. Implementation must use an isolated worktree or otherwise preserve all current Bird/Dog content work; no broad staging, reset, cleanup, or manifest regeneration is authorized.

---

## Implementation Units

### U1. Characterization and pure square geometry

- **Goal:** Establish Dog-local deterministic helpers and tests before modifying runtime integration.
- **Requirements:** R1-R8, R14, R16.
- **Files:**
  - Add `games/find_the_dog/src/scenes/levelFit.ts`.
  - Add `games/find_the_dog/src/scenes/hitboxGeometry.ts`.
  - Update `games/find_the_dog/src/scenes/PinchZoom.ts` with optional `panAtMinZoom` and maximum-zoom contracts plus the pure inertia step.
  - Add `games/find_the_dog/tests/unit/level-fit.test.ts`.
  - Add `games/find_the_dog/tests/unit/hitbox-geometry.test.ts`.
  - Add `games/find_the_dog/tests/unit/pinch-zoom-inertia.test.ts`.
- **Patterns:** Port the corresponding Bird helpers and focused tests, retaining Dog imports and terminology. Do not import Bird modules at runtime.
- **Test scenarios:**
  - Cover fit fills portrait viewport, centers crop, keeps both overflow edges reachable, and never creates bounds outside artwork.
  - `isContinuousSquareLevel` accepts an exact unsectioned square and rejects a rectangle, a sectioned square, missing dimensions, and non-finite dimensions.
  - Tiny square target receives the dimension-scaled minimum; isolated normal target receives forgiving tolerance; close pairs remain nearest-center resolvable; non-square target returns legacy `r * multiplier`.
  - Inertia advances then decays, clamps at each artwork edge, stops on a new gesture, and settles sub-threshold velocity.
  - `PinchZoom` defaults preserve Dog's no-pan-at-1x and 2.5x-maximum behavior when square overrides are absent.
- **Verification:** Focused new unit tests pass without touching level assets or manifests.

### U2. Square cover-fit, camera, tap geometry, and zoom integration

- **Goal:** Make continuous square Dog levels full-bleed, pannable, bounded, and fairly tappable.
- **Requirements:** R1-R8, R14-R16.
- **Depends on:** U1.
- **Files:**
  - Update `games/find_the_dog/src/scenes/GameScene.ts`.
  - Update `games/find_the_dog/src/scenes/PinchZoom.ts` only where integration coverage exposes missing lifecycle behavior.
  - Extend an existing Dog `GameScene` unit/integration test if suitable; otherwise add `games/find_the_dog/tests/unit/square-gameplay-integration.test.ts`.
- **Implementation direction:** Compute `isSquareContinuous` once through `isContinuousSquareLevel(level)` after level layout is known. Only when true, replace contain/mirror setup with cover fit, initial camera scroll, artwork-only bounds, `panAtMinZoom`, inertia, and a 1.75x maximum-zoom override. Route square tap and hint-ring radius through `resolveRuntimeHitRadius`; leave non-square tolerance, contain/mirror fit, pan behavior, and 2.5x ceiling unchanged. Keep the legacy mirror helper for current portrait content.
- **Test scenarios:**
  - Preflight the canonical harness/device lane and record whether it can launch the test-only square fixture without any production manifest or level mutation.
  - Square scene integration uses cover scale and centered scroll; target coordinate conversion remains correct after panning and zooming.
  - Tapping an overlapping close pair collects the closest eligible dog exactly once.
  - Panning at 1.0x is enabled for square continuous levels and disabled for sectioned levels.
  - Pointer slop still separates taps from drags, and pinch focal-point preservation remains unchanged.
  - Classic reveal and restoration pickup still map the selected dog to the correct world/canvas coordinates.
- **Verification:** New integration tests plus the existing Dog unit suite, typecheck, and production build pass.

### U3. Viewport-aware hint selection and edge guidance

- **Goal:** Keep normal hints relevant to the current crop and guide the player to off-screen targets.
- **Requirements:** R9-R10, R13-R15.
- **Depends on:** U2.
- **Files:**
  - Update `games/find_the_dog/src/scenes/GameScene.ts`.
  - Add `games/find_the_dog/tests/unit/hint-viewport-selection.test.ts` or extend a suitable existing scene test.
  - Add the minimal Dog-owned pointing asset under `games/find_the_dog/public/ui/effects/` only if an existing Dog/shared asset search finds no suitable equivalent.
- **Implementation direction:** Gate the new selection path on `isSquareContinuous`; other layouts retain uniform random selection. Search Dog and shared UI assets before copying Bird's pointing hand. A visible candidate has its world-space center inside the camera world view inset by 60 world pixels on each side. Randomly choose within that visible group, otherwise choose the nearest center to the viewport center. Store the active hinted target and update a fixed 150x150 screen-space hand clamped to x=86..width-86 and y=120..height-140; flip horizontally for leftward targets and use perimeter position, not rotation, for vertical/diagonal direction. Clear the indicator and its state on visibility, target find, hint completion, scene shutdown, restart, and level transition.
- **Test scenarios:**
  - Visible candidates always outrank off-screen candidates; seeded/randomized selection stays within the visible set.
  - With no visible candidates, the nearest off-screen dog is selected.
  - Edge position is correct for left, right, above, below, and diagonal targets; the hand flips only for leftward targets and never rotates.
  - Indicator disappears when the target becomes visible, is found, or the scene shuts down.
  - Hint balance decrements exactly once and Dog's rewarded-hint/daily-limit behavior remains unchanged.
- **Verification:** Focused hint tests plus Dog's existing hint, wallet, HUD, analytics, and scene-lifecycle tests pass.

### U4. Viewport-aware Dog tutorial targeting

- **Goal:** Ensure the first tutorial highlights an actually visible dog without importing Bird's tutorial economics or sequence.
- **Requirements:** R11-R15.
- **Depends on:** U2; coordinate with U3's viewport helpers but do not require shared abstraction unless it is already clean and local.
- **Files:**
  - Update `games/find_the_dog/src/scenes/GameScene.ts`.
  - Update `games/find_the_dog/src/ui/TutorialOverlay.ts` only if camera-aware anchor updates require a handle method; preserve all Dog copy and state transitions.
  - Add `games/find_the_dog/tests/unit/tutorial-targeting.test.ts` or extend existing tutorial tests.
- **Implementation direction:** Gate the new tutorial targeting on `isSquareContinuous`; other layouts retain `dogs[0]`. After camera bounds and initial scroll are established, select the nearest unfound dog whose world-space center lies inside the camera world view inset by 60 world pixels. Persist that target ID for the beat-one tap gate instead of indexing `dogs[0]`. If none qualifies, pan to the nearest candidate and open the tutorial only after the pan finishes. Keep Dog's suppressed/free tutorial hint and direct hint-to-zoom transition intact.
- **Test scenarios:**
  - A visible nonzero-index dog is selected when `dogs[0]` is off-screen.
  - During beat one, taps on other dogs and wrong-tap scenery remain swallowed; only the selected target advances.
  - With no visible dog, the scene pans to the nearest candidate and opens exactly one tutorial prompt after completion.
  - Camera movement keeps the spotlight anchored if the overlay remains interactive during pan/zoom.
  - Tutorial hint does not spend inventory or render a real hint pulse, and the existing zoom lesson still completes through pinch or its desktop escape.
- **Verification:** Focused tutorial tests plus existing tutorial, HUD, and first-run persistence tests pass.

### U5. Regression and physical-device acceptance

- **Goal:** Demonstrate that the five selected improvements work in actual Dog gameplay without disturbing adjacent behavior.
- **Requirements:** R1-R16 and AE1-AE6.
- **Depends on:** U1-U4.
- **Files:**
  - Add a dated evidence artifact under `games/find_the_dog/evidence/` following the repository's existing evidence convention.
  - Add a test-harness-only loader for existing packages under `games/find_the_dog/.levelbuilder/levels/`; do not copy them into or modify `public/levels`, `levels-index.json`, `catalog-manifest.json`, or `bundled-manifest.json`.
  - Update no gameplay source unless verification reveals a scoped defect.
- **Test scenarios:**
  - Snapshot the Gallery's active-card session IDs through the same archive/variant/background filtering contract used by `GalleryPage.tsx`; record the expected 81-session corpus without rewriting it.
  - Preflight whether the canonical harness/device lane can launch an existing `.levelbuilder` square package without production-manifest or authoring-package mutation.
  - Exercise `municipal_service_yards_firehouse_court_dog_39a2` and additional Gallery packages that cover edge targets and close pairs through the canonical harness.
  - Exercise `hawaii_rainforest_waterfall_dog_09be` to cover the one 4096x4096 package as well as representative 2688x2688 packages.
  - Run deterministic geometry/visibility coverage across all 81 active Gallery packages; report per-level failures rather than substituting aggregate-only success.
  - Exercise at least one non-square or sectioned Dog level to prove SectionController, legacy hit tolerance, and no-pan-at-1x behavior remain intact.
  - Use hints with both visible and entirely off-screen remaining targets.
  - Run first-time tutorial with `dogs[0]` outside the starting crop.
  - Verify pan inertia, 1.75x zoom ceiling, reachable artwork edges, no gutters, tap/drag separation, wrong-tap life loss, fail overlay, completion, retry, and next-level transition.
- **Verification:** Automated checks across the 81 Gallery packages establish corpus-wide square behavior; when the canonical device lane supports authoring-package launch without mutating either catalog, device proof on named Gallery packages establishes square feel as well. If it does not, square device status must be reported `AUTOMATED ONLY`, never silently replaced by publication or content mutation. A normal build and current published portrait level establish physical adjacent-regression safety. Build, install, launch, and visual gameplay evidence are recorded separately. Still screenshots are sufficient for static bounds and overlays; pan/zoom, inertia, hint tracking, and transitions require a recording or consecutive-frame sequence from the physical device.

---

## Verification Contract

| Gate | Command or evidence | Applies to | Passing signal |
|---|---|---|---|
| Focused geometry | `npm run test:unit -w @fabrikav2/find_the_dog -- tests/unit/level-fit.test.ts tests/unit/hitbox-geometry.test.ts tests/unit/pinch-zoom-inertia.test.ts` | U1-U2 | All new helper tests pass. |
| Focused interaction | `npm run test:unit -w @fabrikav2/find_the_dog -- tests/unit/square-gameplay-integration.test.ts tests/unit/hint-viewport-selection.test.ts tests/unit/tutorial-targeting.test.ts` | U2-U4 | Square, hint, and tutorial scenarios pass; use actual final filenames if existing suites were extended. |
| Dog regression | `npm run test:unit -w @fabrikav2/find_the_dog` | U1-U5 | Entire Dog unit suite passes with no skipped scoped failures. |
| Static correctness | `npm run typecheck -w @fabrikav2/find_the_dog` | U1-U5 | TypeScript exits successfully. |
| Production packaging | `npm run build -w @fabrikav2/find_the_dog` | U2-U5 | Production web build exits successfully. |
| Device identity | Canonical repository device-verification lane | U5 | Recorded installed build identity matches the build produced from the implementation worktree. |
| Gallery corpus audit | Automated geometry and visibility checks across the 81 active Gallery packages | U5 | All 81 receive per-level results; failures name the exact level and target rather than disappearing into an aggregate. |
| Square gameplay evidence | Named `.levelbuilder` Gallery packages through the canonical device lane when supported | U5 | Full-bleed bounds, panning, inertia, zoom, close-pair taps, hint guidance, and tutorial target are visibly demonstrated; otherwise status is explicitly `AUTOMATED ONLY`. |
| Production regression evidence | Physical-phone capture of a current portrait Dog level | U5 | Existing contain layout, 2.5x zoom, random hint/tutorial behavior, lives/failure, completion, and transitions remain intact. |

---

## Definition of Done

- All five selected improvements are implemented in Find the Dog and trace to R1-R13.
- Dog-specific exclusions R14-R16 are covered by automated or physical-device regression evidence.
- The implementation reuses Dog-local copies of the proven generic Bird helpers and does not create a runtime dependency on Find the Bird.
- No level assets, target coordinates, manifests, economy, achievements, health/failure rules, or unrelated UI are changed.
- Focused tests, the full Dog unit suite, typecheck, and production build pass.
- All 81 active Gallery square packages receive deterministic per-level geometry/visibility verification, including the 2688x2688 corpus and the single 4096x4096 package.
- The current build is installed and launched on the connected phone for production-content regression. Named Gallery-package device proof is captured when the canonical lane supports it without authoring or publication mutation; otherwise the square claim is explicitly limited to automated verification.
- The evidence artifact states build, install, launch, automated verification, and visual gameplay results separately, including any remaining blocker or unverified edge case.
