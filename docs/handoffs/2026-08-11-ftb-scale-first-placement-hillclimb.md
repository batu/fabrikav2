# Find the Bird Scale-First Placement Hillclimb

## Mission

Improve automatic cutout-to-painted-bird placement using the complete corpus of human-reviewed Find the Bird levels. The dominant defect is usually **scale**, not translation. Build a leakage-safe, reproducible hillclimb that proposes better sprite boxes, visually validates metric changes, keeps three genuinely different finalists, and ensembles them into a conservative production proposal.

This is post-extraction sprite placement: fit an already-extracted transparent bird sprite onto the matching painted bird in the scene. It is not pre-paint hiding-spot selection, hitbox detection, extraction padding, or cutout regeneration.

## Repository state

- Repo/worktree: `/Users/base/dev/appletolye/fabrikav2`
- Current branch: `fix/ftb-deleted-level-resurrection`
- HEAD at handoff: `81fac235bcdf24b6f3a41ca7cf44700fc136c11a`
- The checkout is heavily dirty with concurrent editor and level-data work. Do not reset, clean, stash, broadly stage, or rewrite unrelated files. Prefer an isolated worktree/branch for the hillclimb after inventorying dependencies.
- Existing evaluation authority:
  - `tools/level-editor/eval/golden-cutout-placement-v1/README.md`
  - `tools/level-editor/eval/golden-cutout-placement-v1/manifest.json`
  - `tools/level-editor/levelbuilder/golden_cutouts.py`
  - `tools/level-editor/eval/overnight-hillclimb/measure.py`
  - `tools/level-editor/eval/runners/ensemble_vote.py`
  - `tools/level-editor/PIPELINE.md`
- The frozen placement manifest currently reports only 9 levels / 161 usable placement trials (36 corrected, 126 kept). The user reports roughly 23 fully reviewed levels now. Treat the manifest as stale until live reviewed canonical levels are enumerated and a new immutable snapshot is built.

## Ground-truth contract

1. Include only levels whose complete current cutout state was explicitly human-approved. Merely opened, generated, cataloged, or partially confirmed levels are not labels.
2. Preserve both `corrected` and explicit `keep` examples. Keeps are essential or a model can appear strong by changing everything.
3. Retain the exact machine-before-human box and final human box. A final box without its pre-edit box cannot supervise correction magnitude.
4. Split by level, never by bird. Birds in one scene are correlated. Use leave-one-level-out or grouped folds.
5. Freeze sprite hashes, scene hashes, level IDs, dimensions, and revision IDs so later extraction or placement edits cannot silently alter the benchmark.
6. Padding/crop geometry must not influence placement scoring. Stable bird identity must be preserved; wrong-neighbor assignments are catastrophic failures, not merely high geometric loss.

## Scale-first loss design

Do not optimize center overlap or IoU alone. They reward a centered but badly sized sprite and can hide the defect the user actually sees.

Report translation and scale separately for every sample:

- log-width error: `abs(log(pred_w / target_w))`
- log-height error: `abs(log(pred_h / target_h))`
- log-area error and aspect-ratio error
- anchor error in pixels, normalized by target diagonal
- edge error: mean absolute left/top/right/bottom deviation normalized by target dimensions
- alpha-aware silhouette fit where scene/cutout pixels permit it; compare rendered sprite edges/foreground support against the painted bird region, not only rectangles
- wrong-neighbor jumps, duplicate target claims, target-identity errors, invalid/out-of-scene boxes
- unchanged performance on human-approved keeps
- per-level and worst-level losses, not only a bird-weighted mean

Primary model-selection objective should weight scale more heavily than translation, with hard safety penalties for identity errors and invalid geometry. Start with an interpretable example such as:

`loss = 0.35*log_width + 0.35*log_height + 0.15*anchor_norm + 0.15*edge_norm + hard_safety_penalties`

Do not canonize those weights without experiments. Compare multiple scale-heavy formulations, inspect their failure sets, and record why the winning metric correlates with visual quality. Always retain IoU and center error as diagnostics, not the sole objective.

## Hillclimb protocol

1. Rebuild/freeze the current reviewed corpus. Produce exact counts by level, corrected/keep balance, missing pre-edit trials, hashes, and exclusions with reasons.
2. Reproduce the current production placer and existing golden evaluation as baseline. Record per-level metrics and render before/target overlays.
3. Add scale-aware features and candidate methods. Favor deterministic methods first: alpha bounds, painted-region support, robust scale regression, per-technique calibration, aspect-preserving scale search, and local pixel/silhouette alignment. Pixelsmith/model judgment may rank hard visual cases, but deterministic evidence remains the default.
4. Run grouped/leave-one-level-out experiments. Each iteration must change one hypothesis, emit a config, metrics JSON, and visual failure contact sheet. Reject metric wins that look worse on pixels.
5. End with three diverse finalists, not three threshold variants of one method. Suggested families: calibrated geometric regressor; local pixel/silhouette optimizer; conservative learned selector/corrector.
6. Ensemble the three proposals. Use agreement/median geometry or a learned grouped-fold selector, abstaining to the current placement when confidence is weak. Never average across different bird identities.
7. Perform blinded visual comparison on held-out levels: baseline vs each finalist vs ensemble vs human target. Use Pixelsmith judgment only where it adds information, record its prompts/model/revisions/cost, and manually inspect representative wins, regressions, and worst cases.
8. Integrate only after the ensemble wins both scale-focused metrics and visual review. Keep automatic safety fail-closed. Manual placement remains a human override bounded by positive in-scene geometry.

## Evidence and cost

- Write results under `tools/level-editor/eval/results/` with immutable configs and per-sample rows.
- Create visual contact sheets/HTML evidence for scale bins, corrected vs keep, per-level worst cases, and disagreement among finalists.
- If using paid vision/LLM calls, read actual spend from `~/.merceka/costs.jsonl`; never estimate when the meter exists.
- Do not mutate reviewed source levels during evaluation. Work from frozen copies/references.

## Verification commands

Orient first and discover the current CLI flags rather than inventing them:

```bash
cd /Users/base/dev/appletolye/fabrikav2
uv run --project tools/level-editor level-editor golden-cutouts-validate --help
uv run --project tools/level-editor level-editor golden-cutouts-placement --help
uv run --project tools/level-editor pytest -q tools/level-editor/tests/test_golden_cutouts.py tools/level-editor/tests/test_flatkey_default.py
```

Run the relevant existing evaluator and all new focused tests after reading the actual CLI help. Also run `git diff --check` on owned files. If production integration changes editor/backend code, run the narrow backend tests plus `npm run build` in `tools/level-editor/ui` when UI contracts change.

## Definition of done

- A new immutable benchmark covers every currently eligible fully reviewed level, with exact inclusion/exclusion accounting and grouped splits.
- Baseline and all candidates have reproducible per-bird, per-level, worst-level, scale, translation, identity, and safety metrics.
- Three diverse finalists and one final ensemble are evaluated on held-out levels.
- The ensemble materially improves scale error over production without regressing identity safety, keep examples, or visually judged placement quality.
- Visual evidence explicitly confirms the metric win and shows worst regressions; no result is accepted from aggregate metrics alone.
- The winning method is integrated behind a safe path with tests, or the honest outcome is a documented no-winner report. Do not ship a worse method to satisfy the task.
- Work continues until this definition is met or a concrete blocker is exhausted and reported. Blocked is not complete.

## First action

Inventory current human-approved canonical final reviews and compare them with `golden-cutout-placement-v1/manifest.json`. Produce the exact eligible level/sample counts and identify how to recover pre-edit placement boxes before changing any loss or model.
