# Canonical FTB Level Pipeline (magenta, native-resolution)

Locked 2026-08-05 after a full elimination day. Every constant below is
evidence-backed; the experiments and their numbers are on the Portal stream
`find-the-bird-reskin-0728` and summarized at the bottom. **Do not change a
constant here without re-running the alignment gate evidence for it.**

## The recipe

```
level-editor create  --setting <s> --scene <sc> --entity bird \
                     --style clean_old_cartoon --view <v> \
                     --aspect-ratio 1:1 --count 16
level-editor author  --session-id <sid> --start-from generate-bg \
                     --stop-after fix-hitboxes --inpaint-mode magenta --strategy smart
# HITL: review hitboxes in the editor (gallery review modal; three-view buttons)
level-editor materialize-hitbox-sprites <sid> [--force]
level-editor recenter-hitboxes-local <sid> --prune-empty
# approve via editor or approve verb; export runs the gates below
```

| Step | Tool / model | Canonical value | Why (evidence) |
|---|---|---|---|
| Background | `google/gemini-3.1-flash-image-preview` | 1:1, 1K | $0.068/call metered; per-image pricing |
| Upscale | `fal-ai/esrgan` (lanczos fallback when no `FAL_KEY`) | target long edge **2688** | ESRGAN input stopped the model inventing junk props (books/padlocks seen with soft lanczos-1K input). Export ships 2560px webps, so 2688 needs no later upscale. |
| Working canvas | — | **2688 × 2688** | Sized so the magenta square-send region is exactly 2048. |
| Placement | smart (vision-scored, `google/gemini-3.5-flash-lite`, metered) | radius **38** (=58 × 2688/4096, canvas-scaled default); 36-candidate pool (floor 2×n), chunks scored in parallel | Deadzones include HUD band, banner band, hint chip, and the side edge-margins (below). The old n×4 floor silently doubled scoring calls (64 candidates / 4 serial calls at 16 birds). |
| Magenta send | `_chrome_crop_box` | square, **2048 × 2048** | Flash's measured native output ceiling is 2048². A square native-size send returns byte-aligned content (gate PASS, 3.98% diff = birds only). Any other aspect/size caused 11–509px content displacement across 5 measured runs — "the docks pasted offset". |
| Side margins | `sections.square_send_side_margin` | sized to square the send | Edge windows showed the worst displacement (43–448px). Margins stay original pixels; placement deadzones exclude them so no dot lands where paint can't reach. Squares still pan — these are artifact buffers, NOT phone-crop deadzones. |
| Paint | flash via guarded client | 1 call, all birds | $0.068 flat regardless of canvas (1120 output image tokens). Client refuses aspect-mismatched returns (>2%) instead of silently stretching — the silent stretch was the root cause of the pickup-seam era. |
| Post-paint snap | `recenter-hitboxes-local --prune-empty` | local diff | With an aligned scene the diff is bird-only, so diff-snap beats VLM boxes (16/16, 0 false). VLM detection (`gemini-3.6-flash`) remains the periodic auditor. |
| Cutouts | flat-key recreate, **batched 2x2 grids** (`FTD_FLATKEY_GRID`, `FTD_FLATKEY_MODEL`) | Gemini Flash, 2x2 default | Controlled human review on 112 paired birds preferred 2x2 over 3x3 by 38–14, with 60 equivalent. Ladder falls back to single; every batch panel passes the deterministic `flat_ok` gate, and the VLM judge runs only on the single fallback. Same-rung grid calls run in parallel (pool of 2). 4x4 passes numeric gates but visibly bleeds panels — capped at 3. Splitter detects magenta components (never split at input coords; no dilation — it bridges gutters). |
| Tap tolerance | runtime `hitboxGeometry.ts` | 2.0× hitbox radius (squares) | Painted birds render larger than their disc; neighbor-overlap clamp prevents shared areas. |
| Restore bg | masked writer | bird-pixels-only + phase-align + sharpness match | Clean patches are unsharp-masked toward local painted crispness (measured 11.98 vs 8.64 gradient energy gap). |

## Export gates (fail closed, no bypass in production)

1. **Local alignment**: 3×3-grid phase correlation, painted vs clean bg, any
   window >8px fails. Catches warps that whole-image checks read as 0
   (symmetric stretch). Dev-only bypass: `FTD_SKIP_ALIGNMENT_GATE=1`.
2. **Paint no-op gate**: subject mask <2% of hitbox disc fails the crop —
   kills silent "16/16 success with zero paint".
3. Center-containment / pairwise-disjoint cleanups / visibility (pre-existing).

## Cost & time per level (metered where a meter exists)

- bg $0.068 · paint $0.068 · cutouts ~$0.07 (batched 3x3 lite) · placement ~$0.01
- VLM audit (`detect_birds_vlm`, ~$0.02/call) — **operator policy, not enforced
  in code**: run it on the first level of every batch, a 1-in-10 sample
  thereafter, and any level with anomalous local-diff counts, large recentre
  snaps, pruned hitboxes, or HITL concern. Do not run it per-level.
- ESRGAN ~2–7¢/call (fal — ledgered as unknown-cost rows; price via rates.json)
- Total ≈ **$0.22–0.25 and 4–6 min**; 20 levels ≈ $5; 1000 levels ≈ $230–250.
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
