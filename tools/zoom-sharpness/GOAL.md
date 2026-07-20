# Goal: max-zoom visual quality — iterate to plateau

## Objective (no preset targets)

Maximize the perceptual fidelity of the fully-zoomed-in view of every find_the_dog
level against the **best image physically producible from that level's source art**,
and keep iterating until the score plateaus. Everything is a variable: the runtime
texture cap, asset encoding/resolution, zoom-aware texture loading, filtering/mipmaps,
`PINCH.maxZoom`, and — if the eval shows the source art itself is the ceiling —
regenerating/upscaling the source art.

## Evaluation

**Reference-anchored, not a proxy.** For a locked camera pose (level, zoom, pan):

- candidate = the actual rendered frame captured from the running game
- reference = the same crop taken from the original full-resolution source PNG,
  Lanczos-resampled to the exact framebuffer size — by construction the best
  achievable image at that pose

Composite score 0–100 per pose:

- 50% MS-SSIM(candidate, reference) — structure; punishes blur AND oversharpening,
  so blind sharpening cannot game the metric
- 30% edge-energy ratio min(grad(candidate)/grad(reference), 1) — sharpness, capped
- 20% PSNR mapped to [0,1] over [20dB, 40dB]

Poses: 3 per level — dog location, densest-detail region (edge-energy argmax on the
source), one seeded-random pose — at max zoom, plus the same poses at zoom 1 as a
regression guard. Aggregate = median across levels AND worst-decile (tail levels
cannot hide).

**Two tiers:**

1. Fast tier (every iteration): headless Chromium via Playwright drives the real
   web build through a `window.__zoomEval` hook (set camera pose → await render →
   capture canvas). Minutes per run; this is the iteration loop's fitness function.
2. Device tier (plateau checkpoints): identical poses captured on the physical
   iPhone via the verify-device path, because desktop-GL filtering and DPR are not
   the A-series GPU. A plateau is only accepted once device-tier confirms it.

**Guardrails, measured every iteration** (an improvement that breaks one is rejected):
zoom-1 composite must not drop; level load time and texture memory within +15% of
baseline; steady 30fps frame budget on device tier.

## Plateau rule

After each accepted change, rerun the fast tier. Stop when the median composite
improves by < 1.0 point for two consecutive accepted iterations. Then:
- run the device tier to confirm;
- check whether the reference itself is the bottleneck (score near ceiling but the
  reference crop is visibly soft): if so, one escalation round on source art
  (higher-res regeneration or SR upscale), re-anchor references, resume the loop;
- otherwise declare plateau and record final scores next to the baseline.

## Baseline (2026-07-20, analytic)

`node tools/zoom-sharpness/audit.mjs`: every level ships 0.40 texels/device-pixel
at max zoom (tutorial levels 0.24). Root causes: webp export + runtime
`MAX_RUNTIME_TEXTURE_LONG_EDGE = 2560` (`GameScene.ts:68`) + camera-only zoom to
2.5× with no higher-res source ever loaded.
