---
title: Cameleon run — device-verify and canvas-shell lessons
date: 2026-07-09
tags: [verify-device, phaser, capacitor, canvas, listener-isolation, ios-alerts, image-gen]
---

# Cameleon run — durable lessons

1. **`game.destroy(true)` detaches the shared canvas.** Any shell that remounts a
   Phaser game into the same `<canvas>` across level switches must destroy with
   `false`, or every later mount renders into a dangling element (blank world,
   no error). Symptom: HUD/DOM fine, canvas shows only the clear color.

2. **Every controller-subscription listener must be isolated.** A throwing
   listener propagates into the notify() caller — which can be a harness verb or
   a driveTo, silently killing the insitu tour. Bit us twice (DOM screen refresh,
   then the Phaser scene's own subscription during teardown races). Wrap listener
   bodies in try/catch and guard `this.sys / this.cameras?.main` in scene
   listeners.

3. **Phaser `type: AUTO` throws "custom environment" outside a detected
   browser** (headless Chromium; potentially other embedders). Pick the renderer
   explicitly by capability and never `await` the canvas mount before wiring the
   test harness/tour — a renderer failure must not kill instrumentation.

4. **iOS system dialogs photobomb XCUITest captures** — including dialogs QUEUED
   BY OTHER APPS on the phone. The verify-device runner now sweeps Springboard
   alerts before capturing, preferring non-granting buttons. Any capture runner
   without a sweep will eventually ship a permission prompt as a "screenshot".

5. **Kit PauseOverlay ships spriteless buttons** (`--fab-btn-sprite-image: none`
   + on-accent label = invisible cream-on-white). Games must give modal actions
   a surface; ResultCard actions take `spriteImage` per action.

6. **ModalShell `id` lands ON the backdrop element** — scope CSS as
   `#id.fab-modal-backdrop`, not `#id .fab-modal-backdrop`.

7. **Image-gen recurring failure classes** (gemini-2.5-flash-image): spec `name`
   leaks into the art as a caption (keep keyers largest-component); ~25% of
   square scenes letterbox (content-box crop repair is reliable); "prone/lying"
   poses regress to standing without HORIZONTAL-emphasis wording; the model
   cannot restyle-preserving-composition (returns the input style — style
   variants are generation-bound); text patches must be measured from zoomed
   crops, never estimated (two mis-patches from guessing).

8. **At-rest baselines for original titles**: put the conductor-accepted device
   captures in the manifest's REFERENCE lane (verify-device scores against that
   lane); refresh deliberately after accepted redesigns, treating phash drift as
   the honest signal it is.
