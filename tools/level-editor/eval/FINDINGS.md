# Hitbox Hillclimb — Findings (2026-08-05)

**Verdict: no $0 challenger beat the incumbent. `place-hitboxes-vlm` (gemini
boxes + local-diff snap) stays canonical.** Per GOAL.md, the honest
deliverable is this table. No `place-hitboxes-local` verb was shipped and
PIPELINE.md is unchanged.

## Final standings (21 labeled golden levels / 412 hitboxes, 1-to-1 gate)

Ranking metrics are one-to-one (GOAL.md amendment, 2026-08-05): duplicates
and overlap double-counting no longer score. This *widened* the incumbent's
lead — the free ensembles had been padding precision with duplicate rings.

| candidate | recall | precision | center px (4096) | cost/level | time/level |
|---|---|---|---|---|---|
| **vlm-snap (incumbent, dim-scaled r)** | **.978** | **.978** | **31.9** | ~$0.02 metered | ~15s |
| vlm-r58-snap (shipped r=58 defaults) | .954 | .954 | 31.2 | ~$0.02 metered | ~15s |
| ensF2hi-snap (best free, recall-lean) | .964 | .758 | 30.7 | $0 | ~10s |
| ensF3hi-snap (best free, balanced) | .927 | .840 | 30.9 | $0 | ~10s |
| yolo11m LOFO composite conf .1 | .93 | .42 | 32.7 | $0 | ~1s |
| local-diff standalone (best sweep) | .39 | .05 | 47.7 | $0 | ~5s |

Target was recall ≥ .97 AND precision ≥ .95 AND center err ≤ 25px at $0.
The incumbent clears recall+precision; **nothing clears all three** — center
error has a ~30px floor across every method (see finding 4). Production
change shipped with this amendment: `place-hitboxes-vlm` now defaults to a
dim-scaled radius (87@4096 via `uniform_hitbox_radius`), worth
+.02 recall / +.02 precision over the old fixed r=58.

## Post-review corrections (2026-08-05 code review)

- **Radius fidelity**: the vlm-snap row uses a dim-scaled r=87 radius; the
  SHIPPED `place-hitboxes-vlm` default is raw r=58, which scores notably
  worse (`vlm-r58-snap`: R .956 / P .954 / 31.2). Same pipeline, same cost —
  **recommend bumping the shipped verb's radius to scale with scene dims**
  (r ≈ 87·dim/4096). Verdict unchanged: the scaled config beats every
  challenger.
- **Metric honesty columns**: contract recall lets one candidate "find"
  every overlapping golden it lands in, and duplicates count as TPs
  (both per GOAL.md's definitions). Measured inflation is small (1-2 birds,
  fairy_ring only; vlm-snap 1-to-1: .978/.978) but the gaming surface is
  real. metrics.json now reports `recall_1to1`/`precision_1to1` alongside
  the contract metrics; RESULTS.md rows carry `min lvl R` (worst-level
  recall — the aggregate hid fairy_ring's .71) and a golden-set sha so rows
  scored against different golden states can't be silently compared.
  **Decision taken (Batu, 2026-08-05): the ranking gate IS the 1-to-1
  metrics** — GOAL.md amended, table regenerated; legacy any-overlap values
  remain as `recall_any`/`precision_any`.
- **Center-error caveat**: the metric is conditioned on matched pairs
  (dist ≤ g.r), so it is truncated at the golden radius — a low-recall
  method's center error describes only its hits. Read it jointly with
  recall; the "~30px floor" is partly a metric ceiling.

Full table: `eval/results/RESULTS.md` (94 runs, all reproducible — each run
dir holds candidates + metrics.json with model/weights/thresholds; fold
weights SHA-256 pinned in `eval/results/yolo-folds-composite/raw/_run.json`,
weights live on ubuntu-server `~/hitbox-lab/runs/detect/yolo11m-fold*/`).

## Findings

1. **Golden set bug**: `ancient_forest_creek_autumn_pond_reeds_bird_da7e` is
   frozen with 0 hitboxes but visibly contains ~25 birds. Every run was
   charged up to 28 phantom FPs until the harness learned to exclude
   unlabeled levels. If it gets hand-labeled, un-exclude it in `score.py`.
2. **Auto-label traps** (cost 3 failed trainings): archived `dogs/*/
   sprite_000.json` spriteBoxes can come from a different paint variant
   (`sourceVariant`) — phantom boxes on empty scenery — and are cutout-space
   sized (~40-60% of the painted bird). The working recipe
   (`build_corpus_v4.py`): anchor every label on the session's human-validated
   hitbox center; use the local diff component only to size the box.
3. **Global repaint drift kills whole-image diff**: on full-repaint levels
   ~34% of pixels differ from the clean bg, so `detect_painted_subjects` is
   unusable standalone there (recall ≤ .40). Local per-hitbox crops (the
   shipped recentre) remain sound.
4. **~30px center-error floor**: VLM+snap 31.9, snapped ensembles ~30.7,
   tuned snap 31.1. Golden centers encode tap ergonomics, not visual
   centroids; no centroid- or detector-based method got near 25px. Treat
   ≤25px as requiring a model trained on many more of Batu's own placements.
5. **One scene style defeats everything**: dense overlapping costumed birds
   (`fairytale_forest_fairy_ring_picnic`). VLM recall .71 there; 11 of 12
   OWLv2 misses are that level; NMS relaxation did not help — the detectors
   genuinely cannot separate those birds.
6. Dead ends measured and logged: diff-evidence FP filter (FPs sit in drift),
   SigLIP crop rerank (TP/FP overlap), snapping to trained-YOLO centers
   (noisier than diff centroid), VLM+free-vote rescue (precision -.05 for no
   recall).

## If the hillclimb resumes

- The corpus grows for free: every shipped level adds a painted scene with
  human-final hitboxes. At ~300-500 sessions a retrained yolo11m (recipe
  above, leave-family-out protocol in `fold_pipeline` scripts) is the
  realistic path to P ≥ .95 at $0.
- Hand-label `_da7e` and one or two dense-cluster scenes first — they are the
  binding recall constraint, and they're exactly the scenes the corpus lacks.
- Eval cost of this session: $0.45 metered (23 gemini calls); all detector
  work on the 4090.
