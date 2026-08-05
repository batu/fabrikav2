---
title: "Auto-labeled YOLO corpus: sprite metadata lied; hitbox-anchored, local-diff-sized labels fixed it"
date: 2026-08-05
category: logic-errors
module: find_the_bird/level-editor-eval
problem_type: logic_error
component: tooling
symptoms:
  - "Three consecutive YOLO fine-tunes: val mAP50 stuck at 0.03-0.20 while train loss converged normally"
  - "ultralytics train_batch0.jpg showed label boxes on empty scenery (phantom birds)"
  - "val_batch0_labels.jpg overlays showed boxes ~40-60% of the painted bird's size, offset from it"
  - "Whole-image diff labels produced giant merged blobs on full-repaint levels (~34% of pixels differ globally)"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - find_the_bird level editor
  - leave-family-out fold training
tags: [yolo, auto-labeling, training-data, object-detection, find-the-bird, label-alignment, ultralytics, image-diff, corpus-generation]
---

# Auto-labeled YOLO corpus: metadata boxes lied, hitbox-anchored + local-diff-sized labels fixed it

## Problem

Building an auto-labeled YOLO training corpus from ~78 archived Find The Bird
level-editor sessions. Each session directory holds a painted scene
(`color.png`), a clean background variant, human-placed tap targets
(`hitboxes.json`), and per-bird materialization metadata
(`dogs/dog_XX/sprite_000.json` with a `spriteBox` rect). The goal: fine-tune
`yolo11m` to detect birds so a $0 local detector could challenge the paid
VLM hitbox placer (`tools/level-editor/eval/FINDINGS.md`).

Three consecutive fine-tunes failed with val mAP50 between 0.03 and 0.20
while train loss converged — the classic signature of a model being taught
labels that do not describe the images.

## Symptoms

- Train loss converged normally across all three runs; val mAP50 never left
  the 0.03–0.20 floor. Nothing in the loss curves or metric tables explained why.
- The failures were invisible in numbers but obvious in pictures:
  ultralytics' own `train_batch0.jpg` render showed label boxes sitting on
  empty scenery, and a 10-line overlay script showed boxes far smaller than
  the painted birds and offset from them.

## What Didn't Work

Attempted in order; each fix was correct and each was insufficient because a
second, independent label defect remained underneath it.

**v1 — raw `spriteBox` metadata as labels.** The corpus manifest
(`tools/level-editor/eval/runners/build_corpus_manifest.py:60-66`) collects
`dogs/dog_*/sprite_000.json → spriteBox` rects per session. 39 of 78
sessions had fewer spriteBoxes than hitboxes: real painted birds with no
label. Every unlabeled bird poisons training as a false negative — the model
is punished for detecting birds that exist.

**v2 — hybrid labels (spriteBoxes ∪ unmatched hitboxes) + per-scene scale
normalization.** Fixed the missing-label count; still failed. Diagnosis came
from actually looking at `train_batch0.jpg`: PHANTOM boxes on empty scenery.
The sprite metadata carries a `sourceVariant` field — the boxes can describe
a **different paint variant** than the `color.png` currently in the session.
The metadata was internally consistent and totally wrong for this image.
Recorded as finding #2 in `tools/level-editor/eval/FINDINGS.md:66-70`
("Auto-label traps (cost 3 failed trainings)").

**v3 — hitbox-anchored presence, spriteBox geometry.** Label presence now
came from `hitboxes.json` (human tap targets — every bird a human confirmed),
and geometry from whichever spriteBox contained each hitbox center. Still
failed. A visual check on a val level showed why: spriteBoxes are
**cutout-space** rects — ~40-60% of the painted bird's size and offset from
it (the v4 docstring's opening line records this:
`tools/level-editor/eval/runners/build_corpus_v4.py:3-4`). Right birds,
wrong geometry, in a second coordinate space.

**Also ruled out — whole-image diff labels** (painted `color.png` minus clean
background). On full-repaint levels ~34% of pixels differ globally (repaint
drift), so the global diff mask is one giant merged blob, useless as bird
boxes. Finding #3 in `tools/level-editor/eval/FINDINGS.md:71-74`; measured
standalone at recall ≤ .40. Crucially, a **local** diff inside a small crop
around a known point stays sound — that asymmetry is what v4 exploits.

## Solution

Corpus v4 (`tools/level-editor/eval/runners/build_corpus_v4.py`, merged in
PR #33 with review hardening) splits the label into two questions and
answers each from the most trustworthy source available:

- **WHERE (center):** the hitbox center, exactly. It is the human-validated
  quantity — and the quantity the model must learn to predict.
- **HOW BIG (extent):** pixel evidence from a *local* diff crop under that
  hitbox, which humans never specified.

Per hitbox, diff a `2.2r`-padded crop of painted vs clean background, find
connected components, and pick the component nearest the hitbox center
(`build_corpus_v4.py:55-75`):

```python
pad = int(r * 2.2)
...
rawdiff = np.abs(a[y0:y1, x0:x1] - b[y0:y1, x0:x1]).sum(axis=2) > 120
diff = ndi.binary_dilation(rawdiff, iterations=5)
labels, _ = ndi.label(diff)
```

Dilation only bridges fragments for component matching; the box size comes
from the **undilated** pixels of the matched component, clamped, with a pure
radius fallback (`build_corpus_v4.py:76-86`):

```python
# Box is ALWAYS centered on the hitbox center (the quantity the model
# must learn to predict); the diff component only sets its size.
half = 1.1 * r
if best is not None:
    _, idx, sl = best
    ys, xs = np.nonzero((labels == idx) & rawdiff)
    if len(xs):
        side = max(int(xs.max() - xs.min()), int(ys.max() - ys.min())) + 8
        half = max(0.8 * r, min(1.6 * r, side / 2))
        n_diff += 1
boxes.append([round(x - half), round(y - half), round(x + half), round(y + half)])
```

(The v4 module docstring still says "Fallback: 1.7*r / clamp [0.9r, 5r]" —
that is stale; the merged code is fallback `1.1r`, clamp `[0.8r, 1.6r]`.)

**Per-session alignment gate** — the piece that makes label-scene mismatch
fail loudly instead of silently poisoning training
(`build_corpus_v4.py:87-89`):

```python
frac_diff = n_diff / len(boxes)
if frac_diff < 0.34:
    dropped.append((sid, f'only {n_diff}/{len(boxes)} diff-derived'))
    continue
```

If fewer than 34% of a session's boxes found real pixel evidence under their
hitboxes, the labels and the image disagree about where the birds are — the
whole session is dropped. (During the session an equivalent density-ratio
formulation was used — mean diff density inside the label boxes ≥ 1.5× the
whole-image density; the merged code carries the fraction-diff-derived form.)
This gate auto-caught the exact session whose phantom boxes had appeared in
the v2 `train_batch0.jpg` render.

Downstream, `tools/level-editor/eval/runners/gpu/build_yolo_dataset_v3.py`
tiles the v4 corpus with per-scene scale normalization
(`median_box → --target-bird` px, line 61) and build-time leakage exclusion
(`--exclude-golden-tagged`, `--exclude-keys`) for leave-family-out folds.

**Result:** val mAP50 0.03 → 0.71; held-out golden recall .84 → .93–1.00
per level (leave-family-out `yolo11m` folds; composite row in
`FINDINGS.md:20`).

## Why This Works

Each failed version trusted one artifact for both presence and geometry, and
no single artifact is trustworthy for both:

- `spriteBox` metadata is materialization-time truth about a *cutout in
  possibly a different variant* — wrong presence (v2's `sourceVariant`
  phantoms) and wrong geometry (v3's cutout-space rects).
- `hitboxes.json` is human-validated presence and center, but carries no
  extent.
- Pixel diffs carry extent, but only locally — global diffs drown in repaint
  drift (finding #3).

v4 composes the three by strength: human artifact for presence and center,
local pixels for extent, and a cheap statistical gate to reject any session
where the composition demonstrably failed. Centering every box on the hitbox
also aligns the training target with the deployment target: the model is
scored on predicting tap centers, so that is what its labels encode.

## Prevention

1. **Never trust materialization/pipeline metadata as scene-space ground
   truth without verifying it against the current image.** It may describe
   another variant (`sourceVariant`) or another coordinate space
   (cutout-space). Both traps were internally consistent and only visibly
   wrong when overlaid on the actual image.
2. **Anchor auto-labels on human-validated artifacts** (tap targets); use
   pixel evidence only for what humans didn't specify (extent).
3. **Build a cheap per-session alignment gate** so label-scene mismatch
   fails loudly — a few lines (`build_corpus_v4.py:87-89`) that would have
   caught the phantom-variant session before the first GPU-hour.
4. **Render label overlays before training.** All three failures were
   invisible in loss curves and val metrics and obvious in 30 seconds of
   looking at ultralytics' `train_batch0.jpg` / `val_batch0_labels.jpg` and
   a 10-line overlay script. Look at what the model is actually fed before
   burning GPU-hours.

## Related

- [data-first-semantic-contract-and-immutable-projections](../architecture-patterns/data-first-semantic-contract-and-immutable-projections.md) — same shape, different domain: derived/untrusted data must not become authority without validation.
- `tools/level-editor/eval/FINDINGS.md` — full hillclimb verdict this corpus work belongs to (PR #33).
