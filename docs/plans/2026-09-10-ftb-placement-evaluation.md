# FTB current-placement evaluation

Evaluate every selected catalog level without modifying artwork, geometry, reviews, or publication state. Compare the pickup sprite in its runtime pose to the painted subject, not a fitted replacement. Hawaii Waterfall and Cozy Library are a user-provided relative calibration pair, not training labels for tuning weights.

## Tasks

- [x] Trace existing evaluators, catalog, and available Ubuntu GPU service.
- [x] Validate a painted-subject segmentation pilot and its limitations visually.
- [x] Extend the existing evaluation CLI with read-only, resumable per-bird and per-level placement scoring.
- [x] Run all selected levels with hashed input provenance and explicit uncertainty/coverage.
- [x] Verify tests and review the ranked HTML report with per-bird visual evidence.

## Measurement contract

Reuse the installed SAM3 environment on Ubuntu. The SAM2 pilot was rejected after visual inspection showed scenery included in bird masks. Subject segmentation uses the painted scene and hitbox, never an optimized sprite placement. Report silhouette overlap, translation and size diagnostics, plus segmentation reliability. Keep ambiguous segmentation unranked; do not conflate it with bad placement. Separate shape/occlusion differences from placement diagnostics. Existing sprite-quality and golden-placement helpers remain the shared foundation where their assumptions apply.

Automatically flag possible pickup residue using the shared runtime cleanup polygons and restoration image, with individual-first and all-collected simulations. Pixel similarity is a candidate detector, not semantic proof. Preserve both raw evidence and uncertainty.

Use the existing 101-level catalog unless the user selects drafts too. Corpus inputs come from the main checkout; the implementation lives in this isolated worktree. Snapshot hashes before processing and verify after. No paid inference, server restarts, level changes, or automatic repairs.

## Review surface

Follow the existing quiet internal-report style: ranked levels first, coverage and uncertainty visible, then expandable per-bird scene/overlay/mask evidence. Search filters and native disclosure controls suffice; no decorative motion. A repeatable CLI and JSON results accompany the HTML.
