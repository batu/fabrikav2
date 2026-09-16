# Handoff: triage the unshipped Find the Bird levels and bring the good ones into the game

Requested by Batu 2026-09-16. Owner: intake agent. Branch off `test/ftb-sticker-tiers` (it has the
editor fixes and the day's build), never off main.

## What exists

- 44 levels are served (`games/find_the_bird/public/levels/bundled-manifest.json`, `bundled: true`).
- `games/find_the_bird/.levelbuilder/levels/` holds 128 sessions; 84 are not in the manifest.
  Of those, roughly 20 are experiments (ids containing `__cmp_`, `_swloc_`, `_flare`, `_sunburst`,
  `_adopt`, `_comp`, `_gpro`, `_gpt2`, `_v1`, `native2k`, `poststretch`, `square_*`) — list them,
  do not ship them. ~10 are empty shells (no color.png). The remaining ~55 are real candidates with
  hitboxes and a painted scene; sprite coverage varies from 0 to complete.
- `games/find_the_bird/public/levels/` has 102 export folders, 58 outside the manifest, same mix.
- A session is "ready to judge" when it has: `color.png` (painted scene, 2688 px), `bg_{selected_bg}.png`
  (upscaled clean plate; `selected_bg` in session.json), `hitboxes.json` (r = 57), and a public export
  with `level.json` + `dogs/dog_NN/sprite_000.png`.

## The workflow (all of it exists, use it, do not rebuild)

Scripts: `docs/solutions/2026-09-16-ftb-sticker-tiers-refit-regen/` (README explains each) and the
session scratch copies referenced there. Editor fixes already on the branch: `flatkey.py` edge-only
despill + `finalize_cutout`; `inpaint.py` Extract All grows crops from the painted extent when no VLM
box; merceka `bef9da9`/`4f11050` for gpt-image-2.5 sizes and rates.

Per level, in this order:
1. **Restoration** through the current writer (`session._write_birdless_restore_bg`, see
   `docs/solutions/2026-09-16-ftb-painted-pixel-pickups/README.md` and memory
   `ftb-stale-restorations-root-cause`): bg_00.png/webp must be the connected-component erase within
   the 2x runtime footprint. Old exports were written by the 1x-rect writer and show residue.
2. **Tier judge**, two classes only: keep (T1/T2) vs regenerate (T3/T4). Judge = `google/gemini-3.8-flash`
   via OpenRouter with the 4-tier prompt (`tier_openrouter.py`, reasoning off, ~$0.002/bird), panels from
   `tierpanels.py` (painted | sticker on grey | 50% overlay). agy is out of quota; do not use it.
   Calibration: 8/8 agreement with agy on the keep/regenerate split (2026-09-16).
3. **Refit** every kept sticker (`refit_all.py`: uniform 0.6–2.0x + width:height 0.8–1.25, gate pop <= 45,
   hitbox inside, overlap). Skips are flagged, not forced.
4. **Regenerate** the regenerate class with `openai/gpt-image-2.5-sunburst`, quality `low`, visible-part
   prompt (`cutout6.py`), crop grown to the painted bird (`cropcheck.py` logic; the editor does this
   now), keyed through the fixed `flatkey` chain, placed by refit (`apply_regen.py`). $0.0082–0.014/bird,
   ~12 s, 4 workers. Save every raw magenta render next to the session
   (`dogs/dog_NN/regen_<date>/`), they cannot be re-derived.
5. **Judge the regenerations** with the same judge; anything still in the regenerate class after one
   pass is listed for Batu, not retried blindly.
6. **Manifest + build**: `manifest.py` (bundled manifest rev bump), then the harness build:
   `node tools/native-shell/install.mjs --game find_the_bird --env-file <copy of
   ~/fabrika-keys/find-the-bird.env.ios.local with VITE_CDN_ENABLED=false and VITE_ENABLE_TEST_HARNESS=true>
   --bundle-id com.basegamelab.findthebird`, unlock the keychain first (MAC_PASSWORD in fabrikav2/.env),
   and only claim installed when the log says `install: OK`. Bundle budget is 200 MB; check size before
   adding many levels (memory `ftb-75-ship-2026-08-14`).
7. **Report** on Portal: `portal report report.html <assets> --stream proj-find-the-bird --title "..."`,
   under ~6 MB per post, 22 px captions on every image, and give Batu the direct page URL
   `https://portal.basegamelab.com/media/<post id>/01_report.html`.

## Deliverables

1. Inventory page first (Portal): every unshipped level with a thumbnail, bird count, sprite coverage,
   restoration age, and a verdict: candidate / experiment / empty. Stop there and let Batu pick or
   confirm the candidate list before spending on regeneration.
2. For the confirmed list: the per-level tier split before and after, refit counts, regeneration
   spend from the ledger (`~/.merceka/costs.jsonl`, never estimated), and a harness build with the
   levels appended after the current 44 in the manifest (do not reorder existing levels).
3. A short "Findings" section appended to this file.

## Rules

- `uv run` for Python, never bare python/pip. No agy. No model calls for anything a script can decide.
- Do not touch the 44 shipped levels' files; the day's work on levels 1–10 is on the branch already.
- Anything painted with the old magenta pass keeps stickers; the painted-pixel lift is parked
  (see its README) and is not part of this workflow.
- Ask before any spend above $10 or any bundle over 200 MB.
