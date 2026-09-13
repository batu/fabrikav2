# Canonical FTB Level Pipeline (magenta, native-resolution)

Locked 2026-08-05 after a full elimination day. Every constant below is
evidence-backed; the experiments and their numbers are on the Portal stream
`find-the-bird-reskin-0728` and summarized at the bottom. **Do not change a
constant here without re-running the alignment gate evidence for it.**

## Banner clearance for future levels (2026-09-13)

Keep the complete painted bird, pickup sprite, and tappable target clear of
the gameplay banner, including feet, tails, and carried props. A safe hitbox
center alone is insufficient. Check the rendered footprint after cover scaling
and throughout reachable camera positions on supported phone aspect ratios.

On the captured iPhone 12 (390 × 844 points), the visible banner occupied
approximately x=35–355, y=755–805: 320 × 50 points, or 6.4:1. It overlaid
the scene rather than reserving layout space. Treat those coordinates as one
measured example, not a universal banner size; adaptive banners and device
safe areas can differ. For default-zoom horizontal panning, reserve the banner's
vertical band across the full level width, with clearance around the artwork.
Also review zoomed/panned positions on device before approving a new level.

This is a generation/review requirement, not a newly implemented export gate.
Existing deadzones must be checked against actual native banner bounds rather
than assumed sufficient. The temporary runtime exclusion list lives in
`games/find_the_bird/src/ads/levelBannerPolicy.ts`: 26 stable IDs selected from
the saved 44-level serving manifest using a conservative local sprite-overlap
audit. Other local catalog folders were not included. Keep these exclusions
until corrected artwork or a viewport fix has physical-device evidence;
sequence reordering alone does not remove an exclusion. Interstitial and
rewarded ads are outside this mitigation.

## The recipe

```
level-editor create  --setting <s> --scene <sc> --entity bird \
                     --style clean_old_cartoon --view isometric_close_20 \
                     --aspect-ratio 1:1 --count 16
level-editor author  --session-id <sid> --start-from generate-bg \
                     --stop-after inpaint --strategy smart
# paint job ends with the VLM localizer: detections become the hitboxes
# (uniform r = 57 at 2688) and their extents land in vlm_detections.json
level-editor bless-hitboxes <sid> --human-confirmed-by <name>   # or the gallery
POST /api/sessions/<sid>/extract-all/jobs        # editor "Extract All" (durable job)
level-editor verify-cutouts --game find_the_bird --vlm <sid>    # ship/amber/flag per bird
# HITL: look at flagged/amber birds only, then "Mark cutouts reviewed" in the editor
# (final cutout approval is server-enforced manual); export runs the gates below
```

`fix-hitboxes`, `materialize-hitbox-sprites`, `recenter-hitboxes-local` and
`repair-sprites` left the lane on 2026-08-13/14 (one-path plan): the in-job VLM
localizer is the only post-paint localizer and Extract All is the only cutter.

| Step | Tool / model | Canonical value | Why (evidence) |
|---|---|---|---|
| Background | `google/gemini-3.1-flash-image-preview` | 1:1, 1K | $0.068/call metered; per-image pricing |
| Upscale | `fal-ai/esrgan` (lanczos fallback when no `FAL_KEY`) | target long edge **2688** | ESRGAN input stopped the model inventing junk props (books/padlocks seen with soft lanczos-1K input). Export ships 2560px webps, so 2688 needs no later upscale. |
| Working canvas | — | **2688 × 2688** | Sized so the magenta square-send region is exactly 2048. |
| Placement | smart (vision-scored, `google/gemini-3.8-flash` since 2026-09-08; 3.6-flash before, metered) | initial radius 38 (=58 × 2688/4096); the post-paint localizer re-mints every hitbox at the uniform catalog radius **57** (=87 × 2688/4096); 36-candidate pool (floor 2×n), chunks scored in parallel | Deadzones include HUD band, banner band, hint chip, and the side edge-margins (below). The old n×4 floor silently doubled scoring calls (64 candidates / 4 serial calls at 16 birds). |
| Magenta send | `_chrome_crop_box` | square, **2048 × 2048** | Flash's measured native output ceiling is 2048². A square native-size send returns byte-aligned content (gate PASS, 3.98% diff = birds only). Any other aspect/size caused 11–509px content displacement across 5 measured runs — "the docks pasted offset". |
| Side margins | `sections.square_send_side_margin` | sized to square the send | Edge windows showed the worst displacement (43–448px). Margins stay original pixels; placement deadzones exclude them so no dot lands where paint can't reach. Squares still pan — these are artifact buffers, NOT phone-crop deadzones. |
| Paint | flash via guarded client | 1 call, all birds | $0.068 flat regardless of canvas (1120 output image tokens). Client refuses aspect-mismatched returns (>2%) instead of silently stretching — the silent stretch was the root cause of the pickup-seam era. |
| Post-paint localization | in-job `localize_hitboxes_from_detections` (`gemini-3.8-flash` boxes, 1024px send) | detections are truth | Detection centers become the hitboxes (ids carried by nearest-assignment within 4r), extents persist to `vlm_detections.json` for Extract All. Empty detection = loud no-op, obligation stays armed. |
| Cutout crop | `extract_box_for_hitbox` | square centered on the hitbox, side 2 × 1.6r; grows to 1.3 × the VLM detection's long edge when that is larger | The tap radius is not the bird's size (painted birds run 1.0-2.0x the disc), so large birds get a bigger square. Cropping TIGHT to the detection was tried and reverted the same day: stickers recreated from tight crops matched the paint far worse (pop median 40 vs 19 on one session). |
| Cutouts | flat-key recreate, **single call per bird** (`DEFAULT_FLATKEY_GRID = 1`, operator 2026-08-13; `FTD_FLATKEY_GRID`, `FTD_FLATKEY_MODEL`) | Gemini Flash image | Grids (2x2/3x3) were the 2026-08-10 quality-matched cheaper option; the operator chose singles on 2026-08-13. Each single passes the deterministic `flat_ok` gate and the semantic judge (fails open without codex). Paid results stage under `.canonical/staging/singles`. |
| Pop guard | `fit_sprite_to_painted` + `POP_GUARD_MAX = 58` | mean \|RGB\| under the sticker vs the painted bird | The sticker is template-matched (scales 0.6-1.4) inside its crop; ≤ 58 ships the sticker at the measured fit, > 58 (or no sticker at all) ships the bird's own painted pixels (`diff-mask-popguard-v1`, exact by construction). Audit 2026-09-08: every gross misplacement was a hybrid fit < 0.46 with pop > 45; stickers rarely match closer than pop 35. Painted-pixel sprites get capped hole filling (`fill_small_holes`, enclosed holes ≤ 12 % of area — bellies matching the clean bg). `FTD_DISABLE_POP_GUARD=1` restores the old behavior; `FTD_DISABLE_FLATKEY_SPRITES=1` skips stickers entirely (measured 2026-09-08 iteration 5: $0.25/level, pop max 11, 54 birds). |
| Placement fit | best-safe (`features`/`orb` RANSAC, else `hybrid`, else `color` ≥ 0.6) | fail-closed | The color fallback used to accept any proposal (fit_color always reports pass); below `COLOR_ACCEPT_MIN` the generated geometry stays. |
| Verification | `verify-cutouts [--vlm]` | pop ≤ 35 & leak ≤ 0.2 ship; pop > 50, leak > 0.5, coverage < 0.35 or residue > 400 px flag; one `gemini-3.8-flash` contact-sheet call ($0.01) escalates misalignment/clipping/wrong_subject/residue findings to amber | Writes `<session>/cutout_verification.json` + `pickup-sheet.png` (PAINTED \| PICKUP-START \| DEPARTED per bird). Incidental VLM findings (a leaf the paint added nearby vanishing) are recorded but do not cost a human look. |
| Tap tolerance | runtime `hitboxGeometry.ts` | 2.0× hitbox radius (squares) | Painted birds render larger than their disc; neighbor-overlap clamp prevents shared areas. |
| Restore bg | masked writer | connected bird pixels within the 2x runtime footprint + phase-align + sharpness match | Erases every changed component touching the cleanup rect (2026-09-08; the rect alone left feet/tails on screen after pickup because stickers run 0.8-0.9x the painted bird). Detached additions stay. Clean patches are unsharp-masked toward local painted crispness (11.98 vs 8.64 gradient energy). |

## Export gates (fail closed, no bypass in production)

1. **Local alignment**: 3×3-grid phase correlation, painted vs clean bg, any
   window >8px fails. Catches warps that whole-image checks read as 0
   (symmetric stretch). Dev-only bypass: `FTD_SKIP_ALIGNMENT_GATE=1`.
2. **Paint no-op gate**: subject mask <2% of hitbox disc fails the crop —
   kills silent "16/16 success with zero paint".
3. Center-containment / pairwise-disjoint cleanups / visibility (pre-existing).

## Cost & time per level (metered where a meter exists)

- bg $0.068 · paint $0.068 · cutouts ~$0.55 at 16 single calls (grids were ~$0.07) · placement ~$0.01 · verify $0.01
- measured 2026-09-08 over 6 levels: **$1.24/level** end-to-end (image model 95 % of spend)
- VLM audit (`detect_birds_vlm`, ~$0.02/call) — **operator policy, not enforced
  in code**: run it on the first level of every batch, a 1-in-10 sample
  thereafter, and any level with anomalous local-diff counts, large recentre
  snaps, pruned hitboxes, or HITL concern. Do not run it per-level.
- ESRGAN ~2–7¢/call (fal — ledgered as unknown-cost rows; price via rates.json)
- Total (2026-08-05 grid era) ≈ $0.22–0.25 and 4–6 min. Measured 2026-09-08 with single-call cutouts: **≈ $1.24 and ~11 min per level** (paint 1.5 min, cutouts 6-8 min, verify 0.5 min); 100 levels ≈ $125.
- Metering closed 2026-08-05: merceka LLM path (placement scoring, sprite
  judge), fal upscale, OpenAI-direct — every provider call now writes
  `~/.merceka/costs.jsonl`.

## What was eliminated (don't relitigate without new evidence)

- **Full-scene paint at non-native size/aspect** — silent stretch, 11–509px
  displacement, five failed rescue experiments (better models, aligned clean
  patch, full-scene removal, per-crop removal, masked removal, LaMa).
- **gpt-image-2 for scene paint** — recomposes layout even aspect-correct
  (114–242px), skips birds, 3× price. Its true-mask edits DO win for per-bird
  work (v1 crop lane: whole birds where gemini prose-edits tore 7/16).
- **Sprite-composite scenes** — rejected on look (sticker feel).
- **1K paint canvas** — same price as native (per-image billing), invented
  junk props from soft input.

## History

The v1 production pipeline (fabrika, 104 shipped FTD levels) achieved
seamless pickups via crop-per-dog paint + diff-extract onto the clean bg
(95%+ byte-identical scenes). This pipeline reaches the same invariant with
full-scene consistency by painting at the model's native resolution instead.
Key session artifacts: `poststretch2` (square-send proof),
`native2k` (canonical end-to-end), `costlane_a` (1K counterexample).
