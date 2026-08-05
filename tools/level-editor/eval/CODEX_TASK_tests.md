# Task: unit tests for canonical-pipeline invariants (level-editor + merceka)

Work in /Users/base/dev/appletolye/fabrikav2 (level-editor tests) and
/Users/base/dev/appletolye/merceka-core (merceka tests). Python via `uv run pytest`.
Do NOT touch application code — tests only. Match existing test style in each repo.

## merceka-core: tests/test_image_guard.py (new)

Target: `merceka_core.image._resize_to_input_guarded(result, original_size)`.
Cases:
1. result.size == original_size → returned unchanged (identity object ok).
2. same aspect, different size (1024² → 2048² requested back to 1024²... i.e.
   result 2048², original 1024²) → resized to original, no raise.
3. aspect delta just under 2% → resized, no raise.
4. aspect delta > 2% (e.g. result 1024x1536, original 1024x1024) → RuntimeError
   mentioning "refusing to stretch".
5. degenerate: original height 0 guarded? (skip if function assumes valid; document).
Use tiny PIL Images (e.g. 8x8) — no network.

## level-editor: tests/test_canonical_geometry.py (new)

In /Users/base/dev/appletolye/fabrikav2/tools/level-editor. Import pattern used
by existing tests (see tests/test_square_deadzones.py: sys.path + settings
apply_game_from_env with LEVEL_EDITOR_GAME=find_the_bird).

1. `levelbuilder.sections.square_send_side_margin(w, h)`:
   - at (4096,4096): margin makes send region square →
     `w - 2*margin == h - hud - banner` within 1px.
   - never below `int(w * SQUARE_SIDE_MARGIN_FRACTION)`.
2. `levelbuilder.api.inpaint._chrome_crop_box(w, h)`:
   - (4096,4096) and (2688,2688): returned box is exactly square.
   - (2688,2688): box size == 2048x2049-ish? assert abs(width-2048) <= 2 and
     square exactly (r-l == b-t).
   - portrait (768,1376): full frame (0,0,w,h).
3. `levelbuilder.api.inpaint._band_feather_mask(size, sides=True)`:
   - all four edges faded (<64), center 255; with sides=False left/right
     edges are 255 at mid-height.
4. `levelbuilder.api.session._require_local_alignment` synthetic:
   - build a tmp session dir with session.json {"selected_bg": 0}, a color.png
     and bg_00.png (512² random-ish PIL images with structure, e.g. gradient +
     rectangles). Identical images → no raise.
   - color = bg shifted 12px (np.roll) → raises LevelNotReadyError mentioning
     "misaligned". Use monkeypatched module attr? _require_local_alignment
     takes (sdir: Path, raw: dict) — call directly with tmp path, no server.
   - env FTD_SKIP_ALIGNMENT_GATE=1 → no raise even when shifted (monkeypatch env).

Run both suites; everything green. Commit in EACH repo with clear messages
(tests only). Do not push.
