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
| semantic defects (codex, subject<0.5) | 66 (23%) | see `semantic_after.json` |
| levels fully regenerated at 0 fail / 0 warn | 0 | 5 of 20 |

Re-exported levels: japan_morning_market_bird_e99f, morning_pirate_cove_pro_standard,
pirate_shipwreck_island_palm_root_ship_ribs_bird_0e47__cmp_crop,
square_grand_bazaar_flash_4k, square_hawaii_waterfall_flash_4k.

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
