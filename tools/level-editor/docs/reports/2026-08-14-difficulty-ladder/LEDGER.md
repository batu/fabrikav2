# Difficulty Ladder — 2026-08-14/15
Goal contract: GOAL.md. 5 levels per tier, one named tweak, eyes-on gate
between tiers. Ask is 30 dogs on every tier; only the tweak varies.

## 2026-08-15 prompt-provenance correction

The ten levels previously reported as T1/T2 are **EXCLUDED** from the
experimental 50. A full persisted-prompt audit found all ten scene prompts
carry the server's `isometric_close_20` view rather than the exact T1
pulled-back view. All five T2 sessions also carry the default entity prompt;
their immutable `inpainted.gen.json` records omit the named smaller-dog delta.
They remain playable catalog levels, but the T1/T2 means and conclusions below
are historical observations from invalid recipes, not ladder evidence.

- Valid T1 count after correction: **0/5**.
- Valid T2 count after correction: **0/5**.
- The three earlier wrong-recipe T3 sessions remain excluded below.
- Corrected T3 uses verified prompt hashes and remains the first valid tier.

The old T1/T2 sections are retained as an audit trail rather than rewritten.
Corrected replacement sections will be appended after their own preflight and
eyes-on gates.

## T1 — map axis: wide view baseline (~30 placements, 6-8 clusters)
japan_river_bridge 23 · uk_cotswolds 23 · sami_aurora_camp 27 ·
hawaii_volcano 21 · nice_promenade 21. **Mean 23.0 / 30 ask.**
Canonical clean on all 5 (0 dupes, 0 spriteless). Detection 115/115 —
zero decoys, including two accidentally hard finds (black lab on volcanic
rock, grey whippet on basalt) and a sweater-poodle asleep on folded
blankets at sami.
VERDICT: PASS. Wide view lifts capacity vs the close-view ramp (23.0 mean
vs 17-21 typical) without any readability loss at phone size. Detection is
NOT yet the limiting factor — headroom exists for the hiding axis.
WATCH: japan_river rendered as a dark-void floating diorama rather than
full-bleed; framing drift to monitor, not yet a defect.

## T2 — size axis: T1 wide view + dogs one notch smaller
cenote_ruins 23 · mardin_stone_terrace 14 · tuscan_hill_village 30 ·
enchanted_stream 28 · pirate_palm_root 25.
VERDICT: PASS on difficulty (smaller dogs read as small props; two of my
own thumbnail reads were wrong and needed zooming — that IS the difficulty
working), but the tier exposed two things bigger than the tweak:
1. **Scene archetype dominates capacity.** Same tier, same 30 ask: dense
   multi-level village 30, forest-with-stream 28, sparse stone terrace 14.
   A 2x swing from scene choice alone — larger than any prompt delta so far.
2. **DEFECT FOUND — magenta residue.** pirate_palm_root shipped the lane's
   magenta placement rings visible in the artwork (64,296 px; healthy
   levels measure 0) while passing every other check: 25 detected,
   canonical clean, no dupes. New deterministic detector +
   test + batch gate landed (levelbuilder/api/magenta_residue.py). Sweep of
   all 29 painted dog levels: 1 defective, now flagged for repaint.
FLAG: mardin has one likely false positive (a cat in a window arch claimed
as a dog) — first of the run; operator's eyes needed.

## T3 invalid attempt — EXCLUDED (recipe mismatch)
These three sessions were labeled as T3, but their persisted session recipes
and immutable `inpainted.gen.json` prompts prove they used the default dog
prompt and the close-view recipe. They are playable levels, but they are not
evidence for the T3 hiding delta and do not count toward the ladder's 50.

- `alpine_meadow_herb_market_garden_dog_d139`: 22 detected. **EYES-ON
  VERDICT: PASS** — fresh current-hitbox overlay reviewed at full resolution;
  22/22 circles land on dogs, no visible uncircled dog. Magenta residue 0 px.
  Canonical state `valid_current`; 22 unique sprite bindings; final cutout
  review current; zero pending obligations. **EXPERIMENT VERDICT: EXCLUDE.**
- `ancient_forest_creek_autumn_pond_reeds_dog_3084`: 30 detected.
  **EYES-ON VERDICT: PASS** — fresh current-hitbox overlay reviewed at full
  resolution; 30/30 circles land on dogs, no visible uncircled dog. Magenta
  residue 0 px. Canonical state `valid_current`; 30 unique sprite bindings;
  final cutout review current; zero pending obligations. **EXPERIMENT
  VERDICT: EXCLUDE.**
- `railway_roundhouse_maintenance_courtyard_loop_dog_ef6e`: 19 detected.
  **EYES-ON VERDICT: PASS** — fresh current-hitbox overlay reviewed at full
  resolution; 19/19 circles land on dogs, no visible uncircled dog. Magenta
  residue 0 px. Canonical state `valid_current`; 19 unique sprite bindings;
  final cutout review current; zero pending obligations. **EXPERIMENT
  VERDICT: EXCLUDE.**

Recovery spend on these excluded levels was $4.706613 from cost-ledger lines
6402–6466 (65 known-cost calls, zero unknown-cost calls).

TIER GATE: **BLOCKED / INCOMPLETE — 0/5 valid T3 levels.** The two previously
unpainted sessions also carry the default recipe and must not be painted in
that state. Author five correctly configured T3 replacements, then run the
normal overlay, residue, canonical, and final-cutout gates before T4.

### T3 corrected preflight — READY, NOT LAUNCHED

Five empty sessions are staged with the exact T3 contract: the T1 pulled-back
view text, 30 requested placements across 6–8 clusters, and the named dog
delta `slightly-smaller-half-occluded`. All five read back with no backgrounds
and no dogs, 1:1 / 1K input, ESRGAN target 2688, the four T3 provenance tags,
and `promptContext.ladderTier = t3`.

- `alpine_meadow_herb_market_garden_dog_411f`: scene prompt SHA-256 prefix
  `2516f248587b`; dog prompt `0c3d358c52f6`; preflight **PASS**.
- `ancient_forest_creek_autumn_pond_reeds_dog_621b`: scene prompt SHA-256
  prefix `51635a193080`; dog prompt `0c3d358c52f6`; preflight **PASS**.
- `railway_roundhouse_maintenance_courtyard_loop_dog_4cfc`: scene prompt
  SHA-256 prefix `f42bc3fa8c06`; dog prompt `0c3d358c52f6`; preflight **PASS**.
- `coral_reef_kelp_coral_arches_dog_4562`: scene prompt SHA-256 prefix
  `327a3eac60a0`; dog prompt `0c3d358c52f6`; preflight **PASS**.
- `greece_olive_grove_press_dog_47c8`: scene prompt SHA-256 prefix
  `b02ba79133be`; dog prompt `0c3d358c52f6`; preflight **PASS**.

Paid-generation checkpoint: cost ledger remains at line 6466. Exact metered
recovery delta is $4.706613; with the operator-supplied $23.50 starting
baseline, the ladder checkpoint is **$28.206613 / $110**. No corrected T3
provider job has been launched. The paid T3 batch requires a fresh explicit
imperative after this gate evidence because the corrected scope is five full
levels, not the two unpainted levels described by the stale handoff.

## T3 corrected — hide axis: smaller dogs + half partially occluded

Exact prompt preflight passed on all five sessions before provider launch:
T1's pulled-back view text, 30 requested placements across 6–8 clusters, and
the exact `slightly-smaller-half-occluded` dog delta. Immutable prompt hashes
are recorded in the preflight section above.

- `alpine_meadow_herb_market_garden_dog_411f`: 24 detected. **EYES-ON
  VERDICT: PASS** — full-resolution overlay has 24/24 circles on dogs and no
  visible uncircled dog; residue 0 px. Full-resolution sprite sheet clean.
  Canonical `valid_current`, 24/24 unique sprite assets, zero pending
  obligations, integrity status `safe` with no issue codes.
- `ancient_forest_creek_autumn_pond_reeds_dog_621b`: 14 detected.
  **EYES-ON VERDICT: PASS AFTER DETERMINISTIC CLEANUP** — all 14 circles land
  on dogs with no visible uncircled dog. A single unpainted 50x49 magenta
  marker at `(928,1023)-(978,1072)` was zoomed at full resolution, proved to
  occupy empty water between reeds, and restored from the selected clean
  background. Residue fell from 2,032 px to 0 without crossing any hitbox.
  Sprite sheet clean. Canonical `valid_current`, 14/14 unique sprite assets,
  zero pending obligations, integrity `safe`.
- `railway_roundhouse_maintenance_courtyard_loop_dog_4cfc`: 23 detected.
  **EYES-ON VERDICT: PASS AFTER CUTOUT REPAIR** — all 23 circles land on dogs;
  residue 0 px. The first sprite sheet exposed one dark dog reduced to a
  transparent outline. A stable-ID extraction-only retry restored its filled
  silhouette; the zoomed replacement and final sheet pass. Canonical
  `valid_current`, 23/23 unique sprite assets, zero pending obligations,
  integrity `safe`.
- `coral_reef_kelp_coral_arches_dog_4562`: 12 detected. **EYES-ON VERDICT:
  PASS** — 12/12 circles on dogs, no visible uncircled dog, residue 0 px;
  sprite sheet clean. Canonical `valid_current`, 12/12 unique sprite assets,
  zero pending obligations, integrity `safe`.
- `greece_olive_grove_press_dog_47c8`: 23 detected. **EYES-ON VERDICT: PASS**
  — 23/23 circles on dogs, no visible uncircled dog, residue 0 px; sprite
  sheet clean. Canonical `valid_current`, 23/23 unique sprite assets, zero
  pending obligations, integrity `safe`.

**T3 mean: 19.2 detected / 30 ask (96 total). TIER GATE: PASS.** This is the
first valid tier after the prompt-provenance audit. Forest and coral are the
first strong evidence that the half-occluded delta can reduce localized
capacity, but there is no valid matched T1/T2 baseline yet, so causality is
reserved until corrected baselines exist.

Cost-ledger checkpoint after T3: lines 6467–6652 add **$9.641936 exact known
USD** and five `fal-ai/esrgan` rows whose provider ledger supplies no USD.
Combined with the prior operator baseline and exact recovery delta, the
checkpoint is **$37.848549 exact known USD + 5 unpriced FAL calls** against
the $110 hard cap. No price-sheet estimate is substituted for those rows.

### Corrected T1 preflight — READY

Matched-scene baseline using the same alpine, forest, railway, coral, and
Greece scenes as corrected T3. Each empty session read back with the exact T1
view, no dog delta, 30 ask, 1:1 / 1K input, ESRGAN target 2688, and T1 tags.

- `alpine_meadow_herb_market_garden_dog_095f`: scene prompt `2516f248587b`,
  dog prompt `4cf48323cccc`; **PASS**.
- `ancient_forest_creek_autumn_pond_reeds_dog_facf`: scene prompt
  `51635a193080`, dog prompt `4cf48323cccc`; **PASS**.
- `railway_roundhouse_maintenance_courtyard_loop_dog_8e17`: scene prompt
  `f42bc3fa8c06`, dog prompt `4cf48323cccc`; **PASS**.
- `coral_reef_kelp_coral_arches_dog_8fe9`: scene prompt `327a3eac60a0`, dog
  prompt `4cf48323cccc`; **PASS**.
- `greece_olive_grove_press_dog_aaab`: scene prompt `b02ba79133be`, dog prompt
  `4cf48323cccc`; **PASS**.

Paid-launch checkpoint: cost ledger line 6652. This preflight supersedes the
five excluded historical T1 sessions.

## T1 corrected — map axis: matched-scene wide-view baseline

- `alpine_meadow_herb_market_garden_dog_095f`: 23 detected. **EYES-ON
  VERDICT: PASS** — full-resolution overlay has 23/23 circles on dogs, no
  visible uncircled dog, and residue 0 px. Full-resolution final sprite sheet
  clean. Canonical `valid_current`, 23/23 unique sprite assets, zero pending
  obligations, integrity `safe` with no issue codes.
- `ancient_forest_creek_autumn_pond_reeds_dog_facf`: 22 detected.
  **EYES-ON VERDICT: PASS AFTER CUTOUT REPAIR** — overlay has 22/22 correct
  circles and residue 0 px. The 3x3 extraction batch included scenery in
  three occlusion-adjacent sprites; stable-ID extraction-only singles removed
  the reeds/log fragments. Final full-resolution sprite sheet clean.
  Canonical `valid_current`, 22/22 unique sprite assets, zero pending
  obligations, integrity `safe`.
- `railway_roundhouse_maintenance_courtyard_loop_dog_8e17`: 19 detected.
  **EYES-ON VERDICT: PASS AFTER MANUAL FULL-RES LOCALIZATION** — paid paint
  succeeded but its VLM response was malformed; the fallback diff localizer
  produced empty circles. A tiled full-resolution review replaced those 30
  candidates with the 19 visible dogs, then a second full-resolution overlay
  verified 19/19 circles and no miss. Residue 0 px; final sprite sheet clean.
  Canonical `valid_current`, 19/19 unique sprite assets, zero pending
  obligations, integrity `safe`.
- `coral_reef_kelp_coral_arches_dog_8fe9`: 21 detected. **EYES-ON VERDICT:
  PASS AFTER CUTOUT REPAIR** — overlay has 21/21 circles and residue 0 px.
  The 3x3 batch's scenery-bearing deep-occlusion sprites were retried by
  stable ID; three stubborn cases required tighter 1.4x/1.0x crops. Final
  full-resolution sprite sheet clean. Canonical `valid_current`, 21/21 unique
  sprite assets, zero pending obligations, integrity `safe`.
- `greece_olive_grove_press_dog_aaab`: 25 detected. **EYES-ON VERDICT: PASS
  AFTER CUTOUT REPAIR** — overlay has 25/25 circles and residue 0 px. One
  table-bearing batch sprite was retried with a tight 1.0x crop; final sheet
  clean. Canonical `valid_current`, 25/25 unique sprite assets, zero pending
  obligations, integrity `safe`.

**T1 mean: 22.0 detected / 30 ask (110 total). TIER GATE: PASS.** Against the
same five scenes, corrected T3's smaller-plus-half-occluded delta lowers mean
localized capacity by 2.8 dogs (19.2 versus 22.0), with the largest losses in
forest and reef. Wide-view baseline itself stays fully detectable.

Cost-ledger checkpoint after corrected T1: lines 6653–6756 add **$3.67969825
exact known USD** and five unpriced `fal-ai/esrgan` rows. The 3x3 cutout batch
lane materially reduced paid recreation calls while retaining the eyes-on
repair gate. Combined checkpoint: **$41.52824725 exact known USD + 10 unpriced
FAL calls** against the $110 hard cap.

### Corrected T2 preflight — PASS

Five empty matched-scene sessions read back with the exact T1 wide-view text,
the exact named T2 smaller-dog delta, 30 ask, 1:1 / 1K input, ESRGAN target
2688, and `promptContext.ladderTier = t2`.

- `alpine_meadow_herb_market_garden_dog_7078`: scene prompt `2516f248587b`,
  dog prompt `352a131dc232`; **PASS**.
- `ancient_forest_creek_autumn_pond_reeds_dog_c676`: scene prompt
  `51635a193080`, dog prompt `352a131dc232`; **PASS**.
- `railway_roundhouse_maintenance_courtyard_loop_dog_e1a1`: scene prompt
  `f42bc3fa8c06`, dog prompt `352a131dc232`; **PASS**.
- `coral_reef_kelp_coral_arches_dog_5ee5`: scene prompt `327a3eac60a0`, dog
  prompt `352a131dc232`; **PASS**.
- `greece_olive_grove_press_dog_1658`: scene prompt `b02ba79133be`, dog prompt
  `352a131dc232`; **PASS**.

Paid-launch checkpoint: cost-ledger line 6756; exact known checkpoint
$41.52824725 plus 10 unpriced FAL calls.

## T2 corrected — size axis: matched wide view + smaller dogs

- `alpine_meadow_herb_market_garden_dog_7078`: 17 detected. **EYES-ON
  VERDICT: PASS AFTER CUTOUT REPAIR** — full-resolution overlay has 17/17
  circles on dogs, no visible uncircled dog, and residue 0 px. The first
  extraction left masonry and a gray scene patch around the lowest dog;
  stable-ID retries at 1.4x then 1.0x removed both. Final full-resolution
  sprite sheet clean. Canonical `valid_current`, 17/17 unique sprite assets,
  zero pending obligations, integrity `safe` with no issue codes.
- `ancient_forest_creek_autumn_pond_reeds_dog_c676`: 22 detected.
  **EYES-ON VERDICT: PASS** — full-resolution overlay has 22/22 correct
  circles, no visible miss, and residue 0 px. Full-resolution sprite sheet
  clean. Canonical `valid_current`, 22/22 unique sprite assets, zero pending
  obligations, integrity `safe`.
- `railway_roundhouse_maintenance_courtyard_loop_dog_e1a1`: 24 detected.
  **EYES-ON VERDICT: PASS AFTER CUTOUT REPAIR** — full-resolution overlay has
  24/24 correct circles and residue 0 px. One clustered extraction contained
  two dogs; a stable-ID 1.4x retry isolated the governed dog. Final sheet
  clean. Canonical `valid_current`, 24/24 unique sprite assets, zero pending
  obligations, integrity `safe`.
- `coral_reef_kelp_coral_arches_dog_5ee5`: 15 detected. **EYES-ON VERDICT:
  PASS** — full-resolution overlay has 15/15 correct circles, no visible miss,
  and residue 0 px. Full-resolution sprite sheet clean. Canonical
  `valid_current`, 15/15 unique sprite assets, zero pending obligations,
  integrity `safe`.
- `greece_olive_grove_press_dog_1658`: 30 detected. **EYES-ON VERDICT: PASS
  AFTER FULL-RES RESIDUE AND CUTOUT REVIEW** — all 30 circles land on dogs and
  no dog is visibly missed. The magenta detector's sole 19x19 component at
  `(592,2363)-(610,2382)` is a poodle basket's intentional pink flower, not
  paint residue, so it was preserved. One fountain-bearing cutout was retried
  at 1.4x then 1.0x and isolated cleanly. Final sprite sheet clean. Canonical
  `valid_current`, 30/30 unique sprite assets, zero pending obligations,
  integrity `safe`.

**T2 mean: 21.6 detected / 30 ask (108 total). TIER GATE: PASS.** Against
matched T1, the named smaller-dog delta changes mean localized capacity by
only -0.4 (21.6 versus 22.0). By contrast, T3's additional half-occlusion
lands at 19.2, 2.4 below T2. At this rung, hiddenness is the repeatable lever;
size alone is not.

Cost-ledger checkpoint after corrected T2: lines 6757–6846 add **$2.67467625
exact known USD** and five unpriced provider rows. Combined checkpoint:
**$44.20292350 exact known USD + 15 unpriced FAL calls** against the $110 hard
cap. No estimate is assigned to the unpriced rows.

### T4 preflight — PASS

Five empty matched-scene sessions independently read back with T1's exact
wide-view string and the exact named T4 delta: `Paint each dog slightly
smaller than furniture-scale props. Hide EVERY dog partially: each dog at
least one-third occluded by scenery — behind props, inside containers, under
furniture — with the head or face still visible.` Each asks for 30 dogs, uses
1:1 / 1K input with ESRGAN target 2688, contains no background or dog output,
and records `promptContext.ladderTier = t4`.

- `alpine_meadow_herb_market_garden_dog_22bd`: scene prompt `2516f248587b`,
  dog prompt `18c08a030945`; **PASS**.
- `ancient_forest_creek_autumn_pond_reeds_dog_c44a`: scene prompt
  `51635a193080`, dog prompt `18c08a030945`; **PASS**.
- `railway_roundhouse_maintenance_courtyard_loop_dog_2547`: scene prompt
  `f42bc3fa8c06`, dog prompt `18c08a030945`; **PASS**.
- `coral_reef_kelp_coral_arches_dog_abf6`: scene prompt `327a3eac60a0`, dog
  prompt `18c08a030945`; **PASS**.
- `greece_olive_grove_press_dog_c634`: scene prompt `b02ba79133be`, dog prompt
  `18c08a030945`; **PASS**.

Paid-launch checkpoint: cost-ledger line 6846; exact known checkpoint
$44.20292350 plus 15 unpriced FAL calls. T2's tier gate is PASS.

## T4 — hide axis: every dog at least one-third occluded

- `alpine_meadow_herb_market_garden_dog_22bd`: 25 detected. **EYES-ON
  VERDICT: PASS AFTER LOCALIZATION, RESIDUE, AND CUTOUT REPAIR** — the first
  localization response was malformed; a VLM retry found 25/25 visible dogs,
  and the full-resolution overlay has no miss. A standalone 57x56 magenta dot
  at `(512,1907)-(569,1963)` was zoomed, proved empty of dog pixels, and
  restored from the clean background; residue is now 0 px. The VLM route
  briefly exposed a legacy `bird_id_set_mismatch` ordering defect; raw dog IDs
  were resynchronized to the reviewed hitboxes before canonical re-adoption,
  which returned `migrate` and `valid_current`. Two scenery-bearing cutouts
  were retried by stable ID; one needed a 1.0x crop. Final full-resolution
  sheet clean, 25/25 unique sprite assets, zero obligations, integrity `safe`.
- `ancient_forest_creek_autumn_pond_reeds_dog_c44a`: 23 detected.
  **EYES-ON VERDICT: PASS** — 23/23 full-resolution circles on dogs, no visible
  miss, residue 0 px, and final sheet clean. Canonical `valid_current`, 23/23
  unique sprite assets, zero obligations, integrity `safe`.
- `railway_roundhouse_maintenance_courtyard_loop_dog_2547`: 26 detected.
  **EYES-ON VERDICT: PASS AFTER CUTOUT REPAIR** — 26/26 correct circles, no
  visible miss, residue 0 px. Four scenery-bearing sprites around worktables,
  pipes, and the inspection pit were retried by stable ID; the final sheet has
  one governed dog per asset and no scene panels. Canonical `valid_current`,
  26/26 unique sprite assets, zero obligations, integrity `safe`.
- `coral_reef_kelp_coral_arches_dog_abf6`: 15 detected. **EYES-ON VERDICT:
  PASS** — 15/15 correct circles, no visible miss, residue 0 px, final sheet
  clean. Canonical `valid_current`, 15/15 unique sprite assets, zero
  obligations, integrity `safe`.
- `greece_olive_grove_press_dog_c634`: 20 detected. **EYES-ON VERDICT: PASS
  AFTER CUTOUT REPAIR** — 20/20 correct circles, no visible miss, residue 0
  px. Five deep-occlusion cutouts initially carried walls, a tree, or a well;
  stable-ID retries at 1.4x/1.0x plus two explicit full-resolution crop boxes
  isolated the governed dogs. Final sheet clean. Canonical `valid_current`,
  20/20 unique sprite assets, zero obligations, integrity `safe`.

**T4 mean: 21.8 detected / 30 ask (109 total). TIER GATE: PASS.** Requiring
every dog to be one-third occluded did not repeat T3's lower capacity: T4 is
+2.6 over T3 and +0.2 over T2. The instruction reliably creates occlusion and
raises cutout-repair load, but detection capacity is scene/run-sensitive at
this rung; it is not yet a repeatable difficulty delta.

Cost-ledger checkpoint after T4: lines 6847–6948 add **$3.61914725 exact
known USD** and five unpriced provider rows. Combined checkpoint:
**$47.82207075 exact known USD + 20 unpriced FAL calls** against the $110 hard
cap.

### T5 preflight — PASS

Five empty matched-scene sessions read back with T1's exact wide-view string
and the exact named deep-occlusion delta: `Paint each dog slightly smaller
than furniture-scale props. Hide EVERY dog: at least one-third occluded, and
for about half of them show only a head, a tail, or paws emerging from behind
scenery — deeply tucked into the scene.` Each asks for 30 dogs, uses 1:1 / 1K
input with ESRGAN target 2688, contains no generated assets, and records
`promptContext.ladderTier = t5`.

- `alpine_meadow_herb_market_garden_dog_516c`: scene `2516f248587b`, dog
  `5ba53ebf1d1a`; **PASS**.
- `ancient_forest_creek_autumn_pond_reeds_dog_5376`: scene `51635a193080`, dog
  `5ba53ebf1d1a`; **PASS**.
- `railway_roundhouse_maintenance_courtyard_loop_dog_2518`: scene
  `f42bc3fa8c06`, dog `5ba53ebf1d1a`; **PASS**.
- `coral_reef_kelp_coral_arches_dog_fdaa`: scene `327a3eac60a0`, dog
  `5ba53ebf1d1a`; **PASS**.
- `greece_olive_grove_press_dog_62b5`: scene `b02ba79133be`, dog
  `5ba53ebf1d1a`; **PASS**.

Paid-launch checkpoint: cost-ledger line 6948; exact known checkpoint
$47.82207075 plus 20 unpriced FAL calls. T4's tier gate is PASS.

## T5 — hide axis: deep occlusion for about half

- `alpine_meadow_herb_market_garden_dog_516c`: 21 detected. **EYES-ON
  VERDICT: PASS** — 21/21 circles on dogs, no visible miss, residue 0 px;
  full-resolution sheet clean. Canonical `valid_current`, 21 unique sprites,
  zero obligations, integrity `safe`.
- `ancient_forest_creek_autumn_pond_reeds_dog_5376`: 23 detected.
  **EYES-ON VERDICT: PASS AFTER CUTOUT REPAIR** — 23/23 circles correct, no
  visible miss; the 1 detected magenta-like pixel is sub-threshold resampling
  noise. A two-headed shepherd extraction was retried by stable ID at 1.0x;
  final sheet clean. Canonical `valid_current`, 23 unique sprites, zero
  obligations, integrity `safe`.
- `railway_roundhouse_maintenance_courtyard_loop_dog_2518`: 18 detected.
  **EYES-ON VERDICT: PASS** — 18/18 circles correct, no visible miss, residue
  0 px, final sheet clean. Canonical `valid_current`, 18 unique sprites, zero
  obligations, integrity `safe`.
- `coral_reef_kelp_coral_arches_dog_fdaa`: 24 detected. **EYES-ON VERDICT:
  PASS** — 24/24 circles correct, no visible miss; 23 magenta-like pixels are
  sub-threshold edge noise, not a ring. Final sheet clean. Canonical
  `valid_current`, 24 unique sprites, zero obligations, integrity `safe`.
- `greece_olive_grove_press_dog_62b5`: 30 detected. **EYES-ON VERDICT: PASS**
  — 30/30 circles correct, no visible miss, residue 0 px, final sheet clean.
  Canonical `valid_current`, 30 unique sprites, zero obligations, integrity
  `safe`.

**T5 mean: 23.2 detected / 30 ask (116 total). TIER GATE: PASS.** Deep
occlusion raises mean localized capacity by +1.4 versus T4 and +4.0 versus
T3. The wording sometimes produces deeply tucked dogs, but the generator also
draws many fully readable bodies; it is not a repeatable capacity reducer.

Cost-ledger checkpoint after T5: lines 6949–7032 add **$2.38830150 exact
known USD** and five unpriced provider rows. Combined checkpoint:
**$50.21037225 exact known USD + 25 unpriced FAL calls** against the $110 hard
cap.

### T6 preflight — PASS

Five empty matched-scene sessions read back with the exact named far-view
delta: `ISOMETRIC axonometric game-map view, elevated three-quarter camera
roughly 35 degrees down from horizontal, pulled back to a wide layout
supporting about 40 hidden target placements. Parallel projection: receding
edges stay parallel, NO vanishing points, NO horizon line, NO eye-level view,
NO foreshortening. Enclosed architecture is an open-top cutaway. Arrange
approximately 40 plausible hiding pockets across 8 to 10 connected prop
clusters; props are moderately smaller than close-view framing but every
ordinary object stays individually recognizable at phone size. No wide-angle
distortion, no depth of field.` The dog prompt is the unchanged default. Each
asks for 30 dogs, uses 1:1 / 1K input with ESRGAN target 2688, contains no
generated assets, and records `promptContext.ladderTier = t6`.

- `alpine_meadow_herb_market_garden_dog_95de`: scene `06a3ee105597`, dog
  `4cf48323cccc`; **PASS**.
- `ancient_forest_creek_autumn_pond_reeds_dog_ba05`: scene `93e18939d48c`, dog
  `4cf48323cccc`; **PASS**.
- `railway_roundhouse_maintenance_courtyard_loop_dog_1af9`: scene
  `ef0008359b68`, dog `4cf48323cccc`; **PASS**.
- `coral_reef_kelp_coral_arches_dog_0d21`: scene `1a2922d6a48e`, dog
  `4cf48323cccc`; **PASS**.
- `greece_olive_grove_press_dog_a36d`: scene `2b4df323e475`, dog
  `4cf48323cccc`; **PASS**.

Paid-launch checkpoint: cost-ledger line 7032; exact known checkpoint
$50.21037225 plus 25 unpriced FAL calls. T5's tier gate is PASS.

## T6 — view axis: farther map / smaller props

- `alpine_meadow_herb_market_garden_dog_95de`: 21 detected. **EYES-ON
  VERDICT: PASS** — 21/21 full-resolution circles on dogs, no visible miss,
  residue 0 px, and full-resolution sprite sheet clean. Canonical
  `valid_current`, 21 unique sprites, zero obligations, integrity `safe`.
- `ancient_forest_creek_autumn_pond_reeds_dog_ba05`: 28 detected.
  **EYES-ON VERDICT: PASS** — 28/28 full-resolution circles on dogs, no
  visible miss, residue 0 px, and full-resolution sprite sheet clean.
  Canonical `valid_current`, 28 unique sprites, zero obligations, integrity
  `safe`.
- `railway_roundhouse_maintenance_courtyard_loop_dog_1af9`: 23 detected.
  **EYES-ON VERDICT: PASS** — 23/23 full-resolution circles on dogs, no
  visible miss, residue 0 px, and full-resolution sprite sheet clean.
  Canonical `valid_current`, 23 unique sprites, zero obligations, integrity
  `safe`.
- `coral_reef_kelp_coral_arches_dog_0d21`: 24 detected. **EYES-ON VERDICT:
  PASS** — 24/24 full-resolution circles on dogs, no visible miss, residue 0
  px, and full-resolution sprite sheet clean. Canonical `valid_current`, 24
  unique sprites, zero obligations, integrity `safe`.
- `greece_olive_grove_press_dog_a36d`: 30 detected. **EYES-ON VERDICT: PASS
  AFTER CUTOUT REPAIR** — 30/30 full-resolution circles on dogs, no visible
  miss, residue 0 px. One near-transparent silhouette extraction was retried
  by stable ID at 1.0x; the repaired full-resolution sheet is clean.
  Canonical `valid_current`, 30 unique sprites, zero obligations, integrity
  `safe`.

**T6 mean: 25.2 detected / 30 ask (126 total). TIER GATE: PASS.** Pulling the
camera farther back increased localized capacity by +2.0 versus T5 and +3.2
versus T1. The wider composition creates more distinct hiding pockets; at this
distance, zoom alone does not reduce detector capacity and therefore is not a
repeatable difficulty lever by itself.

Cost-ledger checkpoint after T6: lines 7033–7125 add **$2.76334100 exact
known USD** and five unpriced provider rows. Combined checkpoint:
**$52.97371325 exact known USD + 30 unpriced FAL calls** against the $110 hard
cap.

### T7 preflight — PASS; paid launch gated

Five empty matched-scene sessions read back with T6's exact far-view string
and the exact named hiddenness delta: `Hide EVERY dog partially: each at least
one-third occluded by scenery with the head or face visible.` Each asks for 30
dogs, uses 1:1 / 1K input with ESRGAN target 2688, contains no generated
assets, and records `promptContext.ladderTier = t7`.

- `alpine_meadow_herb_market_garden_dog_2eb6`: scene `06a3ee105597`, dog
  `721cc4a5ef1d`; **PASS**.
- `ancient_forest_creek_autumn_pond_reeds_dog_a155`: scene `93e18939d48c`, dog
  `721cc4a5ef1d`; **PASS**.
- `railway_roundhouse_maintenance_courtyard_loop_dog_47e6`: scene
  `ef0008359b68`, dog `721cc4a5ef1d`; **PASS**.
- `coral_reef_kelp_coral_arches_dog_b417`: scene `1a2922d6a48e`, dog
  `721cc4a5ef1d`; **PASS**.
- `greece_olive_grove_press_dog_cc4a`: scene `2b4df323e475`, dog
  `721cc4a5ef1d`; **PASS**.

Paid-launch checkpoint: cost-ledger line 7125; exact known checkpoint
$52.97371325 plus 30 unpriced FAL calls. T6's tier gate is PASS. The T7 paid
batch remains unlaunched pending Batu's explicit post-gate imperative `go`.

### Cross-tier prompt audit after T7 staging — PASS

A fresh readback of all 35 corrected ladder sessions confirms one exact view
hash and one exact dog-prompt hash per tier. T1–T5 share view
`01ff763487b8`; T6–T7 share view `314a470d9947`. Dog-prompt hashes are T1
`4cf48323cccc`, T2 `352a131dc232`, T3 `0c3d358c52f6`, T4
`18c08a030945`, T5 `5ba53ebf1d1a`, T6 `4cf48323cccc`, and T7
`721cc4a5ef1d`. Every session's stored `ladderTier` matches its tier. The five
T7 sessions remain exactly empty (0 backgrounds, 0 dogs); the 30 T1–T6
sessions retain their measured assets. This verifies that the named deltas are
isolated as intended and that no paid T7 work occurred during staging.

### Scope-invariant audit after T7 staging — PASS

The live backend reports `game.name = find_the_dog` and `defaultEntity = dog`.
Cost-ledger rows from the ladder launch boundary onward name exactly 33 paid
session IDs: the 30 corrected T1–T6 ladder levels plus the three explicitly
excluded wrong-recipe T3 recovery levels. They name no Find The Bird session
and none of the 55 paused twinning sessions. The T7 sessions are absent from
paid rows because they remain staged and empty. Existing unrelated dirty Bird
files in the shared checkout were not modified or normalized by this run.

### 2026-08-16 operator correction — remaining tiers use independent scenes

Batu clarified that each tier should contain five different, uncorrelated
scene generations and that the following batch should use five new scenes,
not repeat the same five archetypes as controls. The 30 completed T1–T6
levels remain valid playable ladder levels; the repeated-archetype choice is
recorded as an experiment-design mistake, not retroactively hidden. The five
empty repeated-scene T7 drafts were archived without painting or provider
spend. T7–T10 will use 20 unique scenes, one scene from each of five different
setting families per tier and no scene reused across the remaining tiers.

The correction changes interpretation: T1–T6 retain useful matched-scene
comparisons, while T7–T10 measure the requested independent-batch behavior and
their tier means necessarily mix prompt effect with scene-archetype variance.
Findings will report those evidence regimes separately rather than claim false
causal precision.

Batu gave the required post-gate paid imperative and authorized autonomous
continuation with up to **$55 additional exact-known USD** from the
$52.97371325 checkpoint. Therefore the run's tighter exact-known ceiling is
**$107.97371325**; the original $110 total hard cap remains in force. Provider
rows whose ledger USD is null stay separately reported and are never
estimated.

Planned unique assignments, all validated against the live Find The Dog
recipe catalog:

- T7: `japan_night_harbor`, `cozy_village_bakery_kitchen`,
  `underground_crystal_grotto`, `space_colony_modules_rover_garage`,
  `walled_gardens_riad_courtyard`.
- T8: `uk_oxford_college_quad`, `below_decks_cargo_hold`,
  `sweet_factory_chocolate_hall`,
  `ancient_egyptian_compounds_scribes_workyard`,
  `circus_service_compounds_poster_print_shop`.
- T9: `france_montmartre_cafe_terrace`,
  `clockwork_workyards_orrey_foundry`, `castle_keep_armoury`,
  `aquarium_halls_jelly_rotunda`, `indian_craft_bazaars_bangle_market`.

### Corrected independent-scene T7 preflight — PASS

The five superseding empty sessions use five different setting families and
five unique scenes. Each read back T6's exact far-view text and the exact T7
dog delta `Hide EVERY dog partially: each at least one-third occluded by
scenery with the head or face visible.` Each asks for 30 dogs, uses 1:1 / 1K
input with ESRGAN target 2688, has no generated assets, and records
`promptContext.ladderTier = t7`. All dog prompts hash to `721cc4a5ef1d`.

- `japan_night_harbor_dog_6f14`: scene `7efb887b96f0`; **PASS**.
- `cozy_interiors_cozy_village_bakery_kitchen_dog_c9a8`: scene
  `119d94e00439`; **PASS**.
- `underground_crystal_grotto_dog_85fd`: scene `9ec3dc4f347d`; **PASS**.
- `space_colony_modules_rover_garage_dog_c566`: scene `79c694194fc2`;
  **PASS**.
- `walled_gardens_riad_courtyard_dog_0ef7`: scene `97c399d55b2a`;
  **PASS**.

Paid-launch checkpoint: cost-ledger line 7125, $52.97371325 exact known plus
30 unpriced FAL rows. Batu's 2026-08-16 `go autonomous` is the explicit
post-gate paid imperative for this corrected continuation.

## T7 — far map plus every dog at least one-third hidden

All five corrected levels use independent scenes and therefore test the
requested batch behavior, not a matched-scene causal delta. Every overlay and
final sprite sheet was inspected at full resolution.

- `japan_night_harbor_dog_6f14`: **PASS, 21 dogs** — the initial overlay
  review exposed one uncircled dog in the right-side stall. Two guessed circles
  were rejected after zoom; the corrected single 65 px circle covers the one
  continuous dog silhouette. Residue 0 px. Three scenery-bearing sprites were
  retried by stable ID; final sheet clean. Canonical `valid_current`, 21
  sprites, zero obligations, integrity `safe`.
- `cozy_interiors_cozy_village_bakery_kitchen_dog_c9a8`: **PASS, 25 dogs** —
  25/25 circles correct, no visible miss, residue 0 px, full-resolution sprite
  sheet clean. Canonical `valid_current`, 25 sprites, zero obligations,
  integrity `safe`.
- `underground_crystal_grotto_dog_85fd`: **PASS, 28 dogs** — 28/28 circles
  correct, no visible miss, residue 0 px. Six map, crate, sleeping-mat, or boat
  bearing sprites were retried by stable ID; two stubborn occluded cases needed
  explicit crop boxes before the final sheet became clean. Canonical
  `valid_current`, 28 sprites, zero obligations, integrity `safe`.
- `space_colony_modules_rover_garage_dog_c566`: **PASS, 24 dogs** — 24/24
  circles correct, no visible miss, residue 0 px. Two overlapping tire-area
  sprites were isolated by stable-ID retry; final sheet clean. Canonical
  `valid_current`, 24 sprites, zero obligations, integrity `safe`.
- `walled_gardens_riad_courtyard_dog_0ef7`: **PASS, 22 dogs** — 22/22 circles
  correct and no visible miss. One real 8-pixel magenta wall smudge was removed
  deterministically. The remaining 29 detector pixels are legitimate pink
  illustration detail, confirmed by three full-resolution zooms, not placement
  residue. One table-bearing sprite was retried; final sheet clean. Canonical
  `valid_current`, 22 sprites, zero obligations, integrity `safe`.

T7 localized **120 dogs, mean 24.0**. Against T6's matched-scene mean 25.2,
this independent-scene batch is 1.2 lower, but the scene families changed, so
that difference is descriptive rather than a clean prompt effect. The all-dog
one-third-occlusion instruction again increased cutout-repair load without
producing a capacity collapse.

**T7 verdict gate: PASS.** All five levels are playable, canonical-current,
review-current, integrity-safe, and free of actual magenta placement residue.
T8 may launch under Batu's autonomous paid authorization.

Cost-ledger lines 7126–7232 add **$3.85150075 exact known USD** and five
unpriced FAL rows. Combined checkpoint: **$56.82521400 exact known USD + 35
unpriced FAL rows**. This is below the tighter $107.97371325 exact-known
ceiling; no estimate is assigned to null-priced rows.

### Corrected independent-scene T8 preflight — PASS

The five empty T8 sessions use five new setting families and five scenes not
used anywhere in T7. Each read back T6's exact far-view text and the one named
T8 dog delta `Paint each dog compact and small relative to nearby props. Hide
about half of the dogs peeking from behind scenery, at least a quarter
occluded, head visible.` The runtime prompt has exactly one copy of that delta
after the canonical Find The Dog entity prompt; it does not inherit T7's
all-dog instruction. All dog prompts hash to `d6661940f1fc`. Each session asks
for 30 dogs, records `promptContext.ladderTier = t8`, is 1:1 / 1K with ESRGAN
target 2688, and remains 0 backgrounds / 0 dogs before paid launch.

- `uk_oxford_college_quad_dog_b3bc`: scene `935e7c204359`; **PASS**.
- `below_decks_cargo_hold_dog_eb29`: scene `6739a3b351f0`; **PASS**.
- `sweet_factory_chocolate_hall_dog_4fea`: scene `164d1e2d8825`; **PASS**.
- `ancient_egyptian_compounds_scribes_workyard_dog_74bd`: scene
  `066d318aee47`; **PASS**.
- `circus_service_compounds_poster_print_shop_dog_f694`: scene
  `a973d578880b`; **PASS**.

Paid-launch checkpoint: cost-ledger line 7232, **$56.82521400 exact known USD
+ 35 unpriced FAL rows**. T7's verdict gate is PASS and Batu's autonomous paid
imperative remains in force subject to the per-tier gate and hard ceilings.

## T8 — far map plus compact, half-peeking dogs

All five levels use independent setting families and scenes. Every overlay and
final sprite sheet was inspected at full resolution; ambiguous pink illustration
details were zoomed before residue verdicts.

- `uk_oxford_college_quad_dog_b3bc`: **PASS, 24 dogs** — 24/24 circles on
  dogs, no visible miss. The 70 detector pixels are a real pink collar, not
  placement residue. Full-resolution sprite sheet clean. Canonical
  `valid_current`, review-current, zero obligations, integrity `safe`.
- `below_decks_cargo_hold_dog_eb29`: **PASS AFTER CUTOUT REPAIR, 15 dogs** —
  15/15 circles correct, no visible miss, residue 0 px. A greyhound pickup
  initially included its neighbor and a second pickup carried chains and hay;
  stable-ID retries isolated one governed dog per sprite. Canonical
  `valid_current`, review-current, zero obligations, integrity `safe`.
- `sweet_factory_chocolate_hall_dog_4fea`: **PASS AFTER CUTOUT REPAIR, 26
  dogs** — 26/26 circles correct, no visible miss. The 270 detector pixels are
  legitimate purple chocolate ribbons, not placement residue. Five pickups
  carrying racks, sacks, conveyor, machinery, or a bag were retried; the final
  stubborn chef dog required a tight explicit full-resolution crop. Final sheet
  clean. Canonical `valid_current`, review-current, zero obligations, integrity
  `safe`.
- `ancient_egyptian_compounds_scribes_workyard_dog_74bd`: **PASS AFTER
  LOCALIZATION AND CUTOUT REPAIR, 29 dogs** — full-resolution review exposed
  one uncircled tiny Chihuahua at the lower-right table; a 57 px circle was
  added and the complete 29/29 overlay re-reviewed. Residue 0 px. One pickup
  first selected the neighboring dog and furniture; explicit crops isolated
  the governed beagle with the scroll it is visibly handling. Final sheet
  clean. Canonical `valid_current`, review-current, zero obligations, integrity
  `safe`.
- `circus_service_compounds_poster_print_shop_dog_f694`: **PASS, 22 dogs** —
  22/22 circles correct, no visible miss, residue 0 px, full-resolution sprite
  sheet clean. Canonical `valid_current`, review-current, zero obligations,
  integrity `safe`.

T8 localized **116 dogs, mean 23.2**. Against T7's independent-scene mean
24.0 this is 0.8 lower, but the scene families changed, so the delta is
descriptive rather than causal. Compact sizing plus half-peeking did not outrun
detection; it mainly increased extraction-repair work in prop-dense interiors.

**T8 verdict gate: PASS.** All five levels are playable, canonical-current,
review-current, integrity-safe, and free of actual magenta placement residue.
T9 may launch under Batu's autonomous paid authorization.

Cost-ledger lines 7233–7343 add **$3.69870800 exact known USD** and five
unpriced provider rows. Combined checkpoint: **$60.52392200 exact known USD +
40 unpriced FAL rows**. This remains below the tighter $107.97371325
exact-known ceiling; null-priced rows are reported, not estimated.

### Corrected independent-scene T9 preflight — PASS

The five empty T9 sessions use five new setting families and five scenes not
used in T7 or T8. Each read back T1's exact view string (hash
`01ff763487b8`) and exactly one copy of the named tone-matched hiding delta:
`Place each dog among props of a similar color tone to its coat — brown dogs
near wood and baskets, grey dogs near stone and metal, pale dogs near linens —
partially tucked behind or between those props so coat and surroundings blend
at a glance, head visible.` No T7 or T8 dog instruction leaked into the prompt.
All dog prompts hash to `b2d8bce286ad`. Each session asks for 30 dogs,
records `promptContext.ladderTier = t9`, uses 1:1 / 1K input with ESRGAN target
2688, and remains 0 backgrounds / 0 dogs before paid launch.

- `france_montmartre_cafe_terrace_dog_5693`: scene `aa60bdfe9ffd`; **PASS**.
- `clockwork_workyards_orrey_foundry_dog_4921`: scene `d629a26b2940`;
  **PASS**.
- `castle_keep_armoury_dog_c313`: scene `873edc80a8aa`; **PASS**.
- `aquarium_halls_jelly_rotunda_dog_3b10`: scene `2c4af8fada88`; **PASS**.
- `indian_craft_bazaars_bangle_market_dog_0828`: scene `4c2150e5312c`;
  **PASS**.

Paid-launch checkpoint: cost-ledger line 7343, **$60.52392200 exact known USD
+ 40 unpriced FAL rows**. T8's verdict gate is PASS and Batu's autonomous paid
imperative remains in force subject to the per-tier gate and hard ceilings.

## T9 — tone-matched hiding among similar-colored props

All five levels use independent setting families and scenes. Every overlay and
final sprite sheet was inspected at full resolution. Tight crops were used for
the final extraction pass; partial-body pickups are the governed visible parts
of occluded dogs, not foreign props or neighboring targets.

- `france_montmartre_cafe_terrace_dog_5693`: **PASS, 16 dogs** — 16/16
  circles correct, no visible miss, residue 0 px. Canonical `valid_current`,
  review-current, zero obligations, integrity `safe`.
- `clockwork_workyards_orrey_foundry_dog_4921`: **PASS AFTER CUTOUT REPAIR,
  26 dogs** — 26/26 circles correct, no visible miss, residue 0 px. The tight
  extraction pass removed the large scene slabs from the initial grid cutouts.
  Canonical `valid_current`, review-current, zero obligations, integrity `safe`.
- `castle_keep_armoury_dog_c313`: **PASS AFTER CUTOUT REPAIR, 29 dogs** —
  29/29 circles correct, no visible miss, residue 0 px. Full-resolution zoom
  confirmed the apparent armour false positive is a Dalmatian wearing a suit
  of armour. Canonical `valid_current`, review-current, zero obligations,
  integrity `safe`.
- `aquarium_halls_jelly_rotunda_dog_3b10`: **PASS AFTER CUTOUT REPAIR, 20
  dogs** — 20/20 circles correct, no visible miss. The 174 detector pixels are
  a real pink cushion at full-resolution zoom, not placement residue. Canonical
  `valid_current`, review-current, zero obligations, integrity `safe`.
- `indian_craft_bazaars_bangle_market_dog_0828`: **PASS AFTER CUTOUT REPAIR,
  30 dogs** — 30/30 circles correct, no visible miss, residue 0 px. The final
  tight extraction job committed its successful units before OpenRouter
  returned its weekly key-limit 403; the committed sheet was inspected and is
  playable. Canonical `valid_current`, review-current, zero obligations,
  integrity `safe`.

T9 localized **121 dogs, mean 24.2**. This is 2.2 above T1's matched-scene
baseline mean and 5.0 above T3, so tone matching did not repeatably reduce
detection. Because T9 uses unrelated scenes, its count is descriptive rather
than a causal comparison; scene archetype remains the larger source of
variance.

**T9 verdict gate: PASS.** All five levels are playable, canonical-current,
review-current, integrity-safe, and free of actual magenta placement residue.
T10 may launch under Batu's autonomous paid authorization as a confirmation of
the strongest matched-scene lever, T3's compact half-occlusion prompt.

Cost-ledger lines 7344–7625 add **$16.20875250 exact known USD** and five
unpriced provider rows. Combined checkpoint: **$76.73267450 exact known USD +
45 unpriced FAL rows**. This remains below the tighter $107.97371325
exact-known ceiling; null-priced rows are reported, not estimated.

### Independent-scene T10 confirmation preflight — PASS

T10 confirms T3, the strongest matched-scene lever, on five new setting
families and five scenes unused in T7–T9. Each empty session reads back T1's
exact view text (hash `01ff763487b8`) and exactly one copy of T3's named compact
half-occlusion delta: `Paint each dog slightly smaller than furniture-scale
props. Hide about half of the dogs partially behind props: peeking around
crates, under tables, behind plants — at least a quarter of the body occluded,
but head always visible.` All dog prompts hash to `0c3d358c52f6`. No T7, T8,
or T9 instruction leaked into the prompt. Each session asks for 30 dogs,
records `promptContext.ladderTier = t10`, uses 1:1 / 1K input with ESRGAN
target 2688, and remains 0 backgrounds / 0 dogs before paid launch.

- `mexico_dia_de_muertos_plaza_dog_8bfa`: scene `a1cddf35d02e`; **PASS**.
- `nordic_cold_bergen_harbor_dog_7bcd`: scene `65ab5cfbe0db`; **PASS**.
- `hawaii_volcano_national_park_dog_1cda`: scene `d18ec50ee0f9`; **PASS**.
- `prehistoric_dig_enclosures_fossil_pit_dog_f717`: scene
  `913bf311a36e`; **PASS**.
- `municipal_service_yards_firehouse_court_dog_39a2`: scene
  `7e5b3ce0ecb2`; **PASS**.

Paid-launch checkpoint: cost-ledger line 7625, **$76.73267450 exact known USD
+ 45 unpriced FAL rows**. T9's verdict gate is PASS and Batu's autonomous paid
imperative remains in force subject to the $107.97371325 exact-known ceiling.

### T10 launch — BLOCKED before first background

The canonical author lane failed on
`mexico_dia_de_muertos_plaza_dog_8bfa` before producing a background:
OpenRouter returned 403 `Key limit exceeded (weekly limit)`. A read-only
`/api/v1/key` check reported limit $250, weekly usage $250.0810155, and
`limit_remaining = 0`; the account credit balance is not the limiting control.
The repo's same-model direct-Google fallback was then exercised without
restarting the live editor and returned 429 `RESOURCE_EXHAUSTED` because its
prepayment credits are depleted. No different image model was substituted:
that would invalidate T10 as a confirmation of T3.

All five T10 sessions remain canonically staged with audited prompts and zero
backgrounds / zero dogs. Cost-ledger length and spend are unchanged at line
7625: **$76.73267450 exact known USD + 45 unpriced rows**. The operational
unblock is the automatic weekly key reset at Monday 00:00 UTC, or an explicitly
approved OpenRouter key-limit/account change. Completed tiers: **T1–T9**.
T10 and the 50-level completion claim remain blocked.

### T10 resumed and completed — compact half-occlusion confirmation

The OpenRouter account limit was raised externally; `/api/v1/key` then showed
`limit_remaining = 99.9189845`. The audited sessions and exact prompt hashes
above were unchanged, so the same-model T10 run resumed without restaging or
substituting a provider.

- `mexico_dia_de_muertos_plaza_dog_8bfa`: **PASS AFTER CUTOUT REPAIR, 16
  dogs** — 16/16 circles land on dogs with no visible miss. The deterministic
  residue detector reports 13,605 pixels, but component analysis and
  full-resolution crops prove they are authored papel-picado banners, altar
  cloths, and festival ornaments rather than placement rings. One fully
  visible dachshund initially extracted as a paw; a stable-ID semantic retry
  over its full scene box restored the complete dog. Canonical
  `valid_current`, zero obligations, integrity `safe` with no issue codes.
- `nordic_cold_bergen_harbor_dog_7bcd`: **PASS AFTER CUTOUT RECOVERY, 17
  dogs** — 17/17 circles correct, no visible miss, residue 0 px. Four clear
  dogs failed the batch extractor's automatic retry; full-resolution review
  confirmed the targets, and explicit stable-ID crop boxes recovered all four.
  Canonical `valid_current`, zero obligations, integrity `safe`.
- `hawaii_volcano_national_park_dog_1cda`: **PASS, 18 dogs** — 18/18 circles
  correct, no visible miss, residue 0 px; full-resolution sprite sheet clean.
  Canonical `valid_current`, zero obligations, integrity `safe`.
- `prehistoric_dig_enclosures_fossil_pit_dog_f717`: **PASS AFTER CUTOUT
  REPAIR, 15 dogs** — 15/15 circles correct, no visible miss, residue 0 px.
  Two fully visible dogs were clipped by default tight crops; explicit
  full-dog crops restored both. Canonical `valid_current`, zero obligations,
  integrity `safe`.
- `municipal_service_yards_firehouse_court_dog_39a2`: **PASS AFTER CUTOUT
  REPAIR, 15 dogs** — 15/15 circles correct, no visible miss, residue 0 px.
  One provider miss and three clipped fully visible dogs were repaired by
  stable-ID explicit crops, then the complete sheet was re-reviewed.
  Canonical `valid_current`, zero obligations, integrity `safe`.

T10 localized **81 dogs, mean 16.2 / 30 ask**. It repeats the direction of
T3's exact compact half-occlusion prompt on five unrelated scenes: 3.0 below
T3's 19.2, 5.4 below T2's 21.6 size-only tier, and 5.8 below T1's 22.0
baseline. Because T10 changes scenes as well as reusing the dog prompt, its
5.8-dog gap is not a clean causal effect size. It is independent-scene
confirmation that the lever generalizes, while T1–T6 remain the matched-scene
evidence for attribution.

**T10 verdict gate: PASS. LADDER COMPLETE — 50/50 playable levels, 1,103
localized dogs.** Every counted level has an eyes-on overlay and final sprite
verdict, current human reviews, canonical `valid_current`, zero pending
obligations, and integrity `safe`. All actual placement-ring residue was
removed; documented saturated-art false positives were preserved.

Cost-ledger lines 7625–7788 add **$8.26504750 exact known USD** and five
unpriced provider rows. Final ladder spend is **$84.997722 exact known USD +
50 unpriced FAL rows**. No null-priced row is estimated. This leaves
**$25.002278** below the original $110 hard cap and **$22.97599125** below the
tighter user-authorized exact-known ceiling of $107.97371325.

Final aggregate audit: the ten tier evidence summaries enumerate **50 unique
session IDs**. The current integrity audit returns **50/50 `safe`**, **50/50
`valid_current`**, and no issue codes; live session readback returns **50/50
with zero pending obligations**. The stale two-entry T8 evidence index was
deterministically regenerated from its five already-verdict-approved ledger
IDs before this count.
