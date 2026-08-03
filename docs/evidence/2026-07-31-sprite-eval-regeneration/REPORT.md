# Sprite-cutout regeneration report — 2026-07-31 (plan 2026-07-31-002)

## What changed

- **Eval structure (U1–U5):** `level-editor evaluate-sprites` scores exclusion,
  coherence (pickup pop-in), and satellite specks deterministically; a pluggable
  semantic judge (codex subscription = calibrated default, 95% gold agreement)
  scores subject correctness and completeness. Export gate refuses failures.
- **Sprite-only compositing (U6):** scene = clean background + validated sprite.
  Pop-in is impossible by construction; pickup restores pixel-identical bg.
- **Cutout ladder (U7):** SAM2.1-hiera-large on the pato 4090 is now the
  primary cutout (the rung was silently dead — sam2 was never installed);
  4K strict-gate pixel caps fixed; speck rule tightened; prompt-variant
  retries (wider box, diff-centroid point) rescued 30 of 85 flagged birds
  without any provider spend.

## Numbers

| metric | baseline (shipped) | after recut/re-export |
|---|---|---|
| deterministic fails (282 birds) | 164 (58%) | 126 — every re-exported level at 0 |
| semantic defect rate (codex judge) | 23% corpus-wide | **11% on regenerated levels** (7/62); un-regenerated levels unchanged |
| levels fully regenerated at 0 deterministic fail / 0 warn | 0 | 5 of 20 |
| pickup pop-in on device | black rects / scenery pop | zero (win.png, 15/15 pickups) |

Final repaint worklist: **58 birds** (`repaint_final.json`) — 55 from the
original sweep plus 3 semantic finds on regenerated levels (over-inclusive
masks the judge caught post-recut).

Re-exported levels: japan_morning_market_bird_e99f, morning_pirate_cove_pro_standard,
pirate_shipwreck_island_palm_root_ship_ribs_bird_0e47__cmp_crop,
square_grand_bazaar_flash_4k, square_hawaii_waterfall_flash_4k.

## Device evidence (iPhone 12, verify-device lane)

`device/level.png` — regenerated hawaii level rendering on the phone (all 15
birds complete, sticker-integrated). `device/win.png` — after the tour picked
up all 15 birds: background pristine, zero pop-in, zero artifacts.

**Regression found and fixed on the way:** the first device run showed BLACK
rectangles at every pickup site. Root cause: the staged export bypassed the
packaging step that generates `color.webp`/`bg_00.webp` and refreshes
bundled-manifest hashes; the game's prewarm failed decoding the missing webp
and the reveal under-layer rendered black. Reproduced in browser
(`device/browser-pickup-after.png` is the fixed browser run), repaired via
webp regeneration + `upsert_bundled_manifest_level`, now built into
`export_pass.py`, and re-verified on the device.

## Remaining work (see BLOCKERS.md)

- **55 birds across 15 levels need provider repaints** (`repaint_final.json`):
  their paint contains no bird (barrels, foliage, fragments). Blocked on
  OpenRouter credits. After repaint: re-run `recut_all.py` for those levels;
  the gate ships them the moment they pass.
- Two levels additionally carry scrambled id↔paint bindings.
- Corpus-sweep `validate_corpus` keeps `sprite_quality=False` until the last
  level regenerates; flip it then.

## Files

`recut_all.py` (recut + staged export), `retry_cutouts.py` (free SAM2 retry),
`export_pass.py` (compose+export only), `judge_recut.py` (semantic sweep),
`final_repaint_worklist.json` → `repaint_final.json`, `deterministic_after.json`,
`public-levels-backup.tar` (pre-recut corpus snapshot), device captures under
`device/` (verify-device lane).
