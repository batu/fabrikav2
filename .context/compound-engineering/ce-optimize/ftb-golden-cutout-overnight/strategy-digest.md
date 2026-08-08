# FTB golden cutout overnight strategy digest

## Current frontier

- Placement remains nested logistic plus hybrid matching. No tested replacement survived both whole-level metrics and visual review.
- Redo review ranking uses depth-four Extra Trees. Held-out average precision improved from 0.648409 to 0.663984.
- All 162 approved assets and labels retain their manifest hashes. No provider calls or asset writes occurred.

## What worked

- Nesting threshold and movement-cap selection inside each outer held-out level removed the optimistic full-corpus policy leak.
- Extra Trees found a modest but stable redo-ranking improvement. It remains review-only because thresholded precision fell from 0.581 to 0.510.
- Human-target identity, duplicate-target, movement, keep-IoU, correction-IoU, worst-level, and worst-bird gates made misleading aggregate wins visible.

## What failed

- Improvement labels, compact feature sets, polynomial interactions, SVCs, forests, and deeper or slower boosting did not transfer safely across levels.
- The depth-two placement booster produced a nominal 0.000504 objective win, but visual review rejected it: Cozy Library dog_09 and Desert Trading Post dog_04 lost strong corrections, while Attic dog_07 and dog_16 moved away from exact human placements.
- Forest placement had the best raw objective of the run but violated keep preservation. This is a clean example of why the gate is not decorative.

## Plateau

- 23 candidates measured in four serial batches.
- Eight consecutive candidates after the provisional placement winner failed to establish a safer frontier.
- No unapproved dependencies, paid providers, or deferred experiments remain.

## Next useful data

- Add more fully reviewed levels before revisiting placement model complexity.
- Preserve explicit positive and negative selector decisions, especially cases where a matcher proposal looks plausible but targets the wrong neighboring bird.
- Keep redo prediction as queue ordering only until the false-positive rate is acceptable at a useful recall.
