---
status: passed
subject: FTB exported sprite placement and pickup residue evaluation
created: 2026-09-10
mode: pipeline
---

# Evidence: FTB placement and pickup residue

## Verdict

The final CLI run evaluated all 101 catalog levels (1,904 birds), exited 0, and verified every input hash unchanged. It scored 1,376 birds, marked 528 uncertain, and recorded zero execution errors. Fifty-one levels meet the 80% coverage gate for ranking. Residue candidates: 472 individual-first and 452 all-collected flags.

## What Changed

- `evaluate-placements` evaluates the selected catalog with current runtime sprite origins/flips, independent SAM3 bird-body masks, and explicit uncertainty. It makes no placement proposals or authoring mutations.
- Residue diagnostics reuse the runtime cleanup geometry: expanded footprints, protected neighbors, individual-first and cumulative all-collected scenarios. Surviving subject pixels outside cleanup and matching pixels in the restoration asset are separate measurements.
- JSON provenance and searchable HTML include per-bird painted/overlay/mask/after-pickup evidence. Model/image-keyed segmentation caching supports repeat runs.

## Evidence Captured

- Backend: `uv run --no-project --python /Users/base/dev/appletolye/fabrikav2/tools/level-editor/.venv/bin/python python -m pytest tests -q` — 625 passed, three existing deprecation warnings.
- Ruff over the five new Python files and `git diff --check` passed.
- Live worker: existing SAM3 environment on Ubuntu RTX 4090, official cached checkpoint, no downloads or paid inference. JSON-lines request identity rejects stale/mismatched responses and aborts the run after a transport failure.
- Visual review: enlarged Hawaii Waterfall `dog_12` after-pickup simulation shows a remaining upright tail fragment. Its placement score is 86.95; residue includes 1,454 subject pixels outside cleanup and 1,192 matching restoration pixels. Library `dog_09` has a much smaller candidate, not claimed as confirmed residue.
- HTML browser interaction: all 101 rows present; filtering `library` leaves two; following Cozy Library opens its page and Measurements expands. Mobile page overflow was found and corrected with an independently scrolling ranking table.
- Regenerated mobile report at 390×844: no document overflow; table overflows internally, Tab focuses the region, and horizontal scrolling exposes the rightmost columns. Desktop/mobile screenshots were opened and inspected.
- `summary.json` preserves every per-bird measurement and source hash, excluding embedded contact sheets. SAM3 checkpoint SHA-256: `9999e2341ceef5e136daa386eecb55cb414446a00ac2b55eb2dfd2f7c3cf8c9e`.
- Hawaii Waterfall: 81.25 average, 16/19 scored; Cozy Library: 60.91, 19/20 scored. No ranking weights were tuned to this comparison.

## Reviewer Assessments

- Reuse review: existing alpha rasterization, geometric metrics, atomic JSON writes and shared cleanup polygons reused; no blocker.
- Efficiency review: removed unnecessary backend branches, repeated directory setup and duplicate lookups; direct asset/cache reads replace existence checks.
- Quality review: separate CLI preserves existing `evaluate-sprites` contract. Request IDs/fatal transport handling resolve late-response reassignment; incomplete source verification cannot report unchanged inputs.

## Analysis

The initial SAM2 pilot could include surrounding books instead of the bird. SAM3 independently segments `bird` in the painted crop and isolated sprite; held props are excluded consistently. The Hawaii/Library preference was a comparison check, not a label used to tune weights. Model confidence and geometric guards can still miss semantic errors.

## Gaps

- This is an exported-asset diagnostic, not a physical-device pickup animation capture or live CDN readback. No game runtime was changed.
- Integer polygon rasterization and bilinear restoration scaling approximate runtime texture sampling. Fractional edges can differ on device.
- Residue flags are candidates: similar scenery colors can cause false positives, altered-color fragments can be missed, and unreliable subject masks remain uncertain. No automatic repair or human approval is performed.
- Individual-first and fixed array-order all-collected scenarios do not exhaust every pickup ordering.

## Next Action

None for the exported-asset evaluator. Review flagged crops before any artwork repair; benchmark a local VLM separately before using it to adjudicate semantic residue.
