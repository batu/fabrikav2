---
date: 2026-07-20
topic: zoom-max-fidelity-fast-tier-baseline
trello: https://trello.com/c/OaA839ab
card: OaA839ab
stage: brainstormed
status: requirements-locked
source: tools/zoom-sharpness/GOAL.md
---

# Max-Zoom Fidelity Fast-Tier Harness and Baseline Requirements

## Summary

Build the deterministic fast-tier evaluator defined by `tools/zoom-sharpness/GOAL.md`. It must compare the real Find the Dog web build against source-art reference crops at identical camera poses, publish machine-readable scores and a human-review grid, and establish a representative baseline without changing rendering behavior.

## Problem Frame

The existing analytic audit proves that current max-zoom rendering undersamples source art, but it cannot measure the perceptual gap between a rendered frame and the best crop physically producible from the source PNG. The optimization loop in `GOAL.md` needs a repeatable fitness function before any rendering, texture, asset, or zoom change can be judged.

This card establishes only that fast feedback loop and its starting score. Device-tier confirmation, runtime performance guardrails, and fidelity improvements remain later work.

## Assumptions

These decisions fill details not pinned by the card or `GOAL.md` and may be refined during planning if an equally deterministic interpretation is better.

- The representative subset contains at least 15 playable levels and covers both aspect classes accepted by `isPlayableLevelAspect`: portrait and wide landscape.
- "Dog location" means a stable dog selected from level metadata, defaulting to the first dog in source order.
- Seeded-random positions use one documented fixed seed and sample only camera centers that can produce a fully valid source crop.
- The fast tier uses a fixed viewport and device scale factor recorded in its report so baseline and later runs remain comparable.
- The zoom-1 measurements are a reported regression guard. This baseline card does not define a pass/fail threshold beyond recording them.

## Actors

- A1. Fidelity iteration worker: runs the evaluator before and after rendering changes.
- A2. Fast-tier evaluator: selects poses, drives the game, constructs references, scores pairs, and emits artifacts.
- A3. Find the Dog test surface: exposes deterministic level and camera control only outside production builds.
- A4. Reviewer: inspects the HTML candidate/reference pairs when aggregate scores hide a localized visual defect.

## Key Decisions

- **Reference-anchored scoring.** Every score compares the rendered candidate with the same source-art crop resampled to the captured framebuffer size; no proxy-only sharpness score can substitute for this comparison.
- **Determinism over breadth.** A fixed representative subset, fixed viewport, fixed seed, stable pose selection, and stable ordering make repeated runs comparable before expanding to the full catalog.
- **Two zooms per pose.** Max zoom measures the optimization target and zoom 1 records the regression guard from the same spatial locations.
- **Machine and human outputs.** JSON is authoritative for iteration comparisons, while the HTML grid makes crop/alignment mistakes and localized defects visible.
- **No production or rendering delta.** The hook is test-only and this card must not alter texture selection, filtering, assets, camera limits, or other player-visible rendering behavior.

## Key Flows

- F1. Deterministic pose capture
  - **Trigger:** A1 runs the fast-tier evaluator against the real Vite build.
  - **Actors:** A1, A2, A3.
  - **Steps:** The evaluator selects a level and pose, asks the hook to load that level and set the requested zoom and scroll, waits for the render to settle, then captures canvas pixels and the camera/canvas facts required to reproduce the crop.
  - **Outcome:** The candidate capture is tied to one unambiguous level, zoom, viewport, and source-art region.
  - **Covered by:** R1-R8.

- F2. Reference construction and scoring
  - **Trigger:** A candidate capture completes.
  - **Actors:** A2.
  - **Steps:** The evaluator maps the camera view to the original `public/levels/<id>/color.png`, makes the matching crop, Lanczos-resamples it to candidate dimensions, computes the three component metrics, and combines them with the specified weights.
  - **Outcome:** The pose has deterministic component and composite scores plus a candidate/reference pair.
  - **Covered by:** R9-R15.

- F3. Baseline publication
  - **Trigger:** All poses for the representative subset have been scored at max zoom and zoom 1.
  - **Actors:** A2, A4.
  - **Steps:** The evaluator aggregates per-level and cross-level results, writes JSON and HTML, and the worker commits the baseline artifacts.
  - **Outcome:** Later fidelity changes have a reproducible starting point and a visual comparison surface.
  - **Covered by:** R16-R22.

## Requirements

**Test-only game hook**

- R1. Find the Dog must expose `window.__zoomEval` only in dev/test builds behind an explicit environment gate.
- R2. Production builds must not expose the hook or include an active path that can control gameplay through it.
- R3. The hook must accept `{ levelId, zoom, scrollX, scrollY }` and deterministically load the requested level before applying its camera pose.
- R4. The hook must clamp or reject invalid poses consistently and make the effective pose observable to the evaluator.
- R5. The hook must wait until level assets, camera state, Phaser rendering, and browser paint have settled before resolving.
- R6. The hook must return the actual Phaser canvas pixels without screenshotting a substitute DOM or source asset.
- R7. The capture result must provide enough dimensions and effective camera facts to map candidate pixels to the identical source-art crop.
- R8. The hook must reuse the existing test-only level/camera seams where they preserve this contract and must not create player-visible behavior.

**Pose selection and references**

- R9. Each selected level must have exactly three stable spatial poses: dog location, densest-detail region, and seeded-random valid region.
- R10. Densest detail must be selected deterministically by finding the source region with maximum edge energy, with a documented stable tie-break.
- R11. Seeded-random selection must use a documented fixed seed and stable level ordering.
- R12. Every spatial pose must be captured at the runtime max zoom and at zoom 1.
- R13. Each reference must use the original `public/levels/<id>/color.png`, crop the exact camera-visible source region, and Lanczos-resample it to the exact candidate framebuffer dimensions.
- R14. Candidate and reference pairs must have identical dimensions and color-channel treatment before metrics are computed.
- R15. Invalid or incomplete captures must fail the run visibly rather than emit a score from mismatched pixels.

**Scoring and reports**

- R16. Each pose composite must be `50% MS-SSIM + 30% min(candidate edge energy / reference edge energy, 1) + 20% PSNR band`, expressed on a 0-100 scale.
- R17. The PSNR component must map the 20 dB to 40 dB band linearly onto 0 to 1 and clamp outside that band.
- R18. The JSON report must include the run inputs needed for reproducibility, component and composite results for every pose at both zooms, `perLevel`, the cross-level `median`, and `worstDecile`.
- R19. Aggregation order, percentile convention, rounding, and tie-breaking must be documented and deterministic.
- R20. The HTML report must present a navigable grid of labeled candidate/reference pairs with level, pose, zoom, and score context.
- R21. A representative baseline of at least 15 levels covering every playable aspect class must be committed under `tools/zoom-sharpness/baseline/`.
- R22. The committed baseline must identify the exact level subset, viewport/device scale, max zoom, random seed, build revision, and evaluator version or content identity used to produce it.

**Scope and operational constraints**

- R23. The evaluator must drive a real Vite production-style build in headless Chromium through Playwright rather than reimplementing the renderer.
- R24. The evaluator and hook must remain ruthlessly small: no framework, plugin architecture, or general configuration system.
- R25. Implementation must first assess reusable repository dependencies and utilities; adding a new dependency requires explicit authorization because the current workspace does not expose `sharp`, `pixelmatch`, PNG, or SSIM packages.
- R26. Changes are limited to the test hook under `games/find_the_dog/src` and evaluator/baseline artifacts under `tools/zoom-sharpness/`.
- R27. This card must not modify rendering behavior, source art, runtime texture caps, filtering, mipmaps, zoom limits, or asset loading policy.

## Acceptance Examples

- AE1. **Covers R1-R7.** Given a dev/test build is running and a valid level pose is requested, when `window.__zoomEval` resolves, its pixels come from the settled Phaser canvas and its effective camera metadata maps to one exact source crop.
- AE2. **Covers R1-R2.** Given a production build, when the page finishes booting, `window.__zoomEval` is absent and cannot be invoked.
- AE3. **Covers R9-R15.** Given the same revision, level subset, viewport, and seed, when the evaluator runs twice, it selects the same six captures per level and produces byte-identical reference crops and numerically identical scores.
- AE4. **Covers R10.** Given two candidate regions have equal maximum edge energy, when densest-detail selection runs, the documented tie-break chooses the same region on every run.
- AE5. **Covers R12, R16-R20.** Given one spatial pose, when it is evaluated, the JSON contains separate max-zoom and zoom-1 metric components and the HTML shows both labeled candidate/reference pairs.
- AE6. **Covers R15.** Given the hook reports a clamped pose that does not match the requested reference mapping, when scoring would begin, the evaluator fails with the level and pose identity instead of scoring mismatched crops.
- AE7. **Covers R21-R22.** Given the baseline directory is inspected after the run, it contains reports for at least 15 levels spanning portrait and wide-landscape classes plus enough run metadata to reproduce the baseline.
- AE8. **Covers R26-R27.** Given the final branch diff, when compared with its base, no rendering, asset, zoom-limit, or unrelated game files have changed.

## Success Criteria

- One command produces deterministic JSON and HTML fast-tier artifacts from the real Find the Dog build.
- The report makes every aggregate traceable to labeled pose-level component scores and visible candidate/reference pairs.
- The committed baseline covers at least 15 levels and both playable aspect classes.
- Zoom-1 and max-zoom results are recorded separately so later iterations cannot hide regressions behind max-zoom gains.
- Planning can proceed without deciding product scope or redefining the metric contract in `GOAL.md`.

## Scope Boundaries

- No device-tier capture or iPhone plateau confirmation in this card.
- No load-time, texture-memory, or 30fps device guardrail implementation in this card.
- No fidelity improvement, rendering change, asset regeneration/upscale, or source-reference re-anchoring.
- No full-catalog baseline requirement; the committed baseline is representative and includes at least 15 levels across all playable aspect classes.
- No LLM-based image judgment, pose selection, scoring, or pass/fail decision.
- No general-purpose game-harness API expansion beyond what this evaluator requires.

## Dependencies / Assumptions

- `tools/zoom-sharpness/GOAL.md` is the product and metric authority.
- Existing test-only control lives in `games/find_the_dog/src/testing/TestHarness.ts`, including level start and direct camera zoom.
- Camera limits currently come from `games/find_the_dog/src/scenes/PinchZoom.ts`; the evaluator must observe the runtime max rather than silently diverge from it.
- Playable aspect classes are defined by `games/find_the_dog/src/data/playableAspect.ts`.
- Original reference art and level metadata live under `games/find_the_dog/public/levels/<id>/`.
- The root already provides Playwright. The named image/metric packages are not present in the current dependency tree, so planning must find a dependency-free or already-available route unless the user separately approves a dependency addition.

## Outstanding Questions

### Deferred to Planning

- [Affects R5-R7][Technical] What is the smallest hook result shape and settled-render barrier that proves pixels and camera metadata refer to the same frame?
- [Affects R10][Technical] What fixed scan-window and stride make edge-energy argmax representative while keeping the fast tier within minutes?
- [Affects R14, R16][Technical] Which deterministic color-space and alpha handling matches the browser canvas and source PNG without hiding real differences?
- [Affects R16][Technical] What minimal in-repo implementation or already-installed primitive can compute MS-SSIM and image decoding without adding an unauthorized dependency?
- [Affects R18-R19][Technical] Should `median` and `worstDecile` expose max-zoom and zoom-1 aggregates separately, or also provide one top-level target score while retaining both raw groups?

## Sources / Research

- `tools/zoom-sharpness/GOAL.md` defines the reference, score weights, poses, tiers, guardrails, plateau rule, and analytic baseline.
- `tools/zoom-sharpness/audit.mjs` is the existing analytic audit and establishes the current runtime-cap/max-zoom inputs.
- `games/find_the_dog/src/testing/TestHarness.ts` exposes current deterministic test controls and camera snapshots.
- `games/find_the_dog/src/scenes/GameScene.ts` owns the Phaser scene, canvas render path, runtime textures, and current test-harness gate.
- `games/find_the_dog/src/scenes/PinchZoom.ts` defines `PINCH.maxZoom` as 2.5 on this revision.
- `games/find_the_dog/src/data/playableAspect.ts` defines portrait and wide-landscape playability.
- Root `package.json` provides Playwright; the current dependency tree contains none of `sharp`, `pixelmatch`, `pngjs`, or `ssim.js`.
