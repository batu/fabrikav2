# Hitbox Placement Hillclimb — Goal

## Mission

Produce a hitbox placer whose output on a new painted level needs **zero or
near-zero human correction** — measured, not vibed. Batu's 412 hand-placed
hitboxes across 22 levels (frozen in `golden-hitboxes-2026-08-05/`) are ground
truth. The current baselines (gemini VLM boxes; local-diff snap) required a
manual pass on every level; the winner should make that pass a spot-check.

## The target function

A placement is GOOD when a player who sees the bird and taps it is rewarded,
and a player who taps where there is no bird is not. Concretely, per golden
hitbox g and candidate c:

1. **Recall** — every golden bird has its OWN candidate: matching is
   one-to-one, so one candidate dropped between overlapping goldens counts
   once, not twice (a missed bird is an unfindable target: the worst
   failure class). *(Amended 2026-08-05: originally "a candidate whose
   center lies inside g" — any-overlap; that variant is still reported as
   `recall_any`. Review found the any-overlap form inflatable in dense
   scenes.)*
2. **Precision** — every candidate is the match of some golden bird
   (one-to-one; duplicates stacked on an already-matched bird count
   against precision — a false positive is a "miss" tap on nothing: the
   second-worst class, and the one Batu kept hitting on-device).
   *(Amended 2026-08-05: originally any-overlap, reported as
   `precision_any`.)*
3. **Center error** — mean distance from candidate center to its matched
   golden center, in level px (normalize by level size for cross-level
   comparison).
4. **Radius fit** — |c.r − g.r| / g.r for matched pairs. Golden radii encode
   tap generosity, not bird extent; a detector that returns tight boxes must
   learn the golden inflation factor, not ship bbox halves.

**Composite score (rank by, in order): recall, precision, then center error.**
Radius fit reported but ranked last — the runtime's 2.0× tolerance already
forgives moderate radius error.

## Constraints

- **Zero or near-zero marginal cost per level.** The candidates run on
  ubuntu-server's 4090. Gemini VLM ($0.07/scene) is the incumbent to beat and
  the cost ceiling.
- **Deterministic and reproducible**: pinned weights, pinned thresholds, seed
  where stochastic. A placer that can't reproduce its own eval score is out.
- **Cartoon domain is the domain.** These are flat-shaded line-art scenes.
  COCO-trained "bird" priors half-work; candidates should be evaluated on OUR
  images only. No credit for ImageNet elegance.
- **Two distinct sub-problems — don't conflate:**
  - *Post-paint detection* (find painted birds): the hillclimb's main event.
    Local-diff is near-perfect WHEN a clean bg exists (canonical lane) — the
    winner must beat or complement it for the no-clean-bg / audit cases.
  - *Pre-paint dot placement* (choose good hiding spots): NOT this eval;
    stays with smart placement + HITL.

## Candidate space (be creative; this list is a floor, not a ceiling)

1. Open-vocabulary detectors on the 4090: GroundingDINO, OWLv2, YOLO-World,
   Florence-2 grounding, DETIC (LVIS `bird`).
2. **Self-trained cartoon-bird detector**: our own archived sessions contain
   hundreds of painted birds with diff-derived positions = a free
   auto-labeled training corpus. Fine-tune a small YOLO on it. A dedicated
   2D-cartoon bird class model, built from our own art. Likely the endgame.
3. Ensembles: local-diff proposals ∪ detector proposals, gated by agreement.
4. Anything else research turns up (anime/cartoon-domain detection work,
   SAM-family concept prompting).

## Protocol

- Split: 22 levels → eval on all (report per-level), but any TRAINED
  candidate must hold out the level it's evaluated on (leave-one-level-out or
  train only on archived non-golden sessions).
- Every run logs: model+weights hash, thresholds, per-level metrics, total
  wall-clock, GPU memory. Results table lives in `eval/results/`.
- The winner ships as a `level-editor place-hitboxes-local` verb calling the
  4090 (same contract as `place-hitboxes-vlm`), with golden-set score in its
  docstring, and PIPELINE.md gets updated.

## Definition of done

A placer that, on the golden 22, achieves **recall ≥ 0.97 and precision
≥ 0.95 with mean center error ≤ 25px** (4096-space) — i.e., measurably better
than both incumbents — and runs a level in under 30 seconds at $0.
If nothing beats the incumbents, the honest deliverable is that table.
