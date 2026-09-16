# Find the Bird: sticker tiers, geometry refit, and sunburst regeneration (2026-09-16)

Branch `test/ftb-sticker-tiers`, phone build `7c661f506`. Levels 1-8 only.

- `agy_tiers.py` + `tierpanels.py`: judge panels (painted | sticker on grey | 50% overlay) and the
  agy 4-tier prompt. Shipped stickers on levels 1-8: T1 58, T2 45, T3 28, T4 13 (`agy-tiers-shipped-L1-8.json`).
- `refit_all.py`: geometry refit of every sticker, uniform scale 0.6-2.0 + translation, plus
  width:height ratio 0.8-1.25 (`UNIFORM=1` disables the ratio search). Gate: pop <= 45, hitbox inside,
  overlap with the old box. Levels 1-8: 130/144 applied. `refit-L1-8.json` has the per-bird numbers.
- `regen41.py` + `cropcheck.py`: the 41 T3/T4 birds regenerated with `openai/gpt-image-2.5-sunburst`,
  quality low, visible-part-only prompt (in `cutout6.py`), $0.0082 per call; 34 of 41 needed the crop
  grown to the painted bird because levels 1-8 have no VLM detections (`regen41-runs-*.json`).
  agy after regeneration: T1 18, T2 18, T3 5, T4 0 (`agy-tiers-regenerated-L1-8.json`).
- `apply_regen.py`: writes the best cutout per bird into the level, with the keying fixes the editor
  still lacks: despill only on the antialiased edge (the editor's `despill` greys every green or
  magenta-ish pixel, which is why shipped green birds and the level-1 flower hat have grey patches),
  key-coloured gaps stay transparent, small keyed plumage holes are filled, transparent RGB is filled
  from the nearest solid pixel before resize and zeroed after (no key-colour fringe).
- Raw model renders, cutouts, crops and fits for every regenerated bird are saved in
  `games/find_the_bird/.levelbuilder/levels/<id>/dogs/dog_NN/regen_2026-09-16/` (gitignored session
  data, same place as every other session artifact). The shipped stickers' raw renders were never
  stored by the editor, so they cannot be re-keyed; the flower hat needs a regeneration.

Findings that go upstream into `tools/level-editor`: the despill bug, the 182 px crop without VLM
detections, gpt-image-2.5 minimum pixel budget (merceka `bef9da9`), sunburst low as the sticker model.
