# Find the Bird: painted-pixel pickup sprites (no per-bird cutout model call)

Status: idea committed 2026-09-16, device-reviewed on levels 18, 23, 25, 29 (branch
`test/ftb-painted-pixels`). Not in the level editor yet; corpus trial pending Batu's quality bar.

## Problem

The pickup sprite that flies to the counter is a recreated sticker (flat-key model call, one per
bird). Calibrated against Batu's labels on 78 birds, the shipped stickers split roughly 22% perfect,
40% right bird wrong size (visible shrink at frame 0), 10% colour or prop drift, 27% wrong bird,
pose, or sitting on a different bird than the hitbox. Every non-perfect class is a property of the
sticker being a redrawing rather than the paint.

## Recipe (deterministic, no model call)

1. `painted_diff_mask(painted crop, clean plate crop)`: pixels the paint pass changed.
2. Voronoi split: keep only pixels nearer to this bird's hitbox centre than to any other hitbox.
   Without it, touching birds paint as one blob and all of them fly on the first pickup
   (level 29 cluster; 20 of 78 birds shared paint with a neighbour).
3. Keep connected components touching the hitbox disc (1.2 r), binary opening, `fill_small_holes`.
4. Sprite = scene RGB under that mask, alpha feathered 0.7 px, capped at 288 px long edge.
   `sprite.x/y/width/height/anchorX/anchorY` derived from the mask bbox and the hitbox.

Frame 0 of the pickup is identical to the scene by construction, so tiers 2 to 4 cannot occur.

## Known costs and their flags

- Partly occluded birds fly as a sliver. Flag: refit-sticker bite > 15%, refit failure
  (pop >= 45 or bite >= 90%), or visible paint < 0.6 hitbox discs. 22 of 78 flagged on the four
  calibration levels; Batu: "those can get a pass" but wants them listed.
- Shadows and swept-up props (pencil, desk slab) ride along. A hue-based shadow rule was measured
  and rejected (it strips a median 29% of each mask, i.e. bird bodies). Clipping the mask to the
  refit sticker silhouette dilated 6 px removes them cleanly where a sticker exists (58 of 78
  trustworthy); without stickers a geometric shadow rule is the open item.
- Carried vs stationary props: the mask cannot know; policy from 2026-09-15 leans to keeping
  stationary objects in the scene.

## Evidence

Portal stream `proj-find-the-bird`: "Pickup tier calibration: 78 birds", "Tier-2 repair candidates",
"Lifted-mask dirt". Scratch analysis under the session scratchpad `tierjob/`.

## Pipeline consequence if adopted

Cutout calls drop from n per level to the occlusion-flagged handful (or zero if slivers are
accepted): about $0.55 and 6 to 8 minutes of the $1.24 / 11 minutes per level, plus the
verify-cutouts and cutout HITL stages.

## Afternoon findings (2026-09-16): what the praised build actually is, and what was rejected

Status: promising, **not adopted for the current 44 levels**. Batu played the full-corpus version and
judged the debris (shadows, drift, adjacent props) too high on the first levels. Parked as a method.

The build Batu praised on levels 18/23/25/29 is commit `2d338dee4` (`painted-pixels-v2-voronoi`):
scene diffed against the session's own clean plate `bg_{selected_bg}.png` at the diff function's
default threshold 40, search crop = sticker box padded 0.8x, hitbox-touching components, Voronoi
split, opening 1, small-hole fill, 0.7 px alpha feather. Reproduced byte-exact on all 40 liftable
levels in `1e60aee95` (branch `test/ftb-painted-pixels-approved`).

Two changes made while fixing levels 40-43 regressed every level and were mistaken for the method's
own debris:

- threshold 30 instead of 40: median sprite grows ~10%, one level-29 bird 2.6x; everything between
  30 and 40 is the drift that is supposed to stay in the scene.
- diffing against the shipped restoration `bg_00.png` instead of the session plate: the erase edge is
  blended, so every bird gains a thin outline halo (164/164 birds on levels 1-8, 29).

Keep the session plate as the reference. Levels 40-43 (Aug-4 full-scene repaint era) have no
pixel-identical plate; keep their stickers or inpaint a plate for them.

Variants tried on top of the lift and rejected by Batu on device or in Portal panels:

- drift rule (thick = survives 3 px erosion, drop specks < 150 px, 6 px attachment chain): cleaner,
  but still carries beams, sills and wall pieces the bird stands on (they are thick and attached).
- Gemini 3.8 Flash outline polygons via OpenRouter, three-input prompt (painted + dot, plate,
  candidate): cut bird parts; native PNG masks undecodable from the API.
- inverted "scenery stays" polygons: 2/37 leftovers in tapcheck, never judged on device.
- SAM 3.1 on fal (`fal-ai/sam-3-1/image`, text "bird", multi-mask, pick by tap, $0.01, ~2 s):
  clean animal body but drops worn and held items; point prompts return whole-image masks.
- SAM + attach rule (attached pieces <= 1.2x bird area, extent <= 0.6x): lost the flower hat on
  level 1 bird 10. "Trash."

Related: the level editor already has a diff-mask cut in `session.py` materialize
(`diff-mask-popguard-v1`, `diff-mask-no-sticker`, since 2026-09-08) that fires when the sticker pops
above `POP_GUARD_MAX`. It has no Voronoi split against neighbours; that is the one piece this work adds.

Scratch tools (session scratchpad `pipeline/`): `v2_exact.py` (the praised recipe), `lift.py`
(all variants via `LIFT_RULE`/`THR`), `restore_under_mask.py`, `tapcheck.py`, `sam.py`, `polys.py`.
