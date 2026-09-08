---
status: partial
subject: Find the Dog read-only difficulty CLI
created: 2026-09-08
mode: pipeline
---

# Evidence: Find the Dog difficulty scorer

## Verdict

The implemented CLI passes local safety, scoring and resume tests and a real
10-level offline pilot run; paid inference and human-difficulty calibration
remain unverified.

## What Changed

- Added `level-editor difficulty` as a server-free, offline-by-default command.
- Added exact asset-hash validation, aspect-preserving inputs, strict detection
  schema, one-to-one matching, per-dog frequencies and provisional ascending
  score reports.
- Added bounded opt-in OpenRouter requests, provider cost recording, persistent
  per-trial state, budget reservations, output locking and safe cache resume.
- Documented invocation, score semantics, budget behavior and limitations in
  `tools/level-editor/README.md`.

## Work Checklist

1. Complete: inspect existing CLI, eval matching, provider and ledger patterns.
2. Complete: implement dry-run and bounded scoring/report path.
3. Complete: local tests, whole-pilot offline run and no-spend model preflight.
4. Complete: three review agents, fixes, final checks and documentation.

## Evidence Captured

Commands run from `tools/level-editor`:

```sh
uv run pytest tests/test_difficulty.py tests/test_cli_contract.py \
  tests/test_cli_errors.py tests/test_cli_parity.py tests/test_cli_matrix_axes.py -q
uv run ruff check levelbuilder/difficulty.py levelbuilder/cli/main.py tests/test_difficulty.py
git diff --check
uv run level-editor difficulty \
  --manifest ../../docs/research/2026-09-08-ftd-difficulty-pilot.json --json
uv run level-editor difficulty \
  --manifest ../../docs/research/2026-09-08-ftd-difficulty-pilot.json --preflight --json
```

- Tests: **60 passed**, one existing Starlette/httpx deprecation warning.
  The initial two CLI tests were observed failing before implementation because
  the verb did not exist. Tests exercise actual CLI parsing, dry-run, matching,
  malformed model output, stale assets, corrupt caches, cost limits, resumption,
  timeout ambiguity, output locks and path constraints. Paid requests in tests
  use `httpx.MockTransport`; metering is patched and makes no real ledger writes.
- Ruff and whitespace check: passed. No frontend or game runtime code changed;
  UI builds and device tests were not used as proxy evidence for this CLI.
- Whole pilot: **10 levels / 313 dogs / 30 planned requests**. The child CLI
  was run with Google/OpenRouter API keys removed from its environment.
  Hashes of **338 source files** (including selected-game and local sequence
  workflow state) were identical before and after. The cost ledger's size and
  nanosecond mtime were identical. See [read-only-check.json](read-only-check.json).
- Model preflight: exact `google/gemini-3.8-flash` found in the public catalog;
  no generation or credential use. Its captured conservative next-call reserve
  is $1.634304, **not estimated or actual spend**. See [preflight.json](preflight.json).
- Paid production requests executed: **0**. No sequence, approvals, artwork or
  hitbox edits; no backend restart, deployment or publication.

## Reviewer Assessments

`difficulty_reuse`, `difficulty_quality`, and `difficulty_efficiency` ran
read-only, bounded reviews under the simplify/code-review workflows. Reuse
found no behavior-equivalent existing replacement. The quality pass found
cache-cost validation and explicit model/level identity issues; all were fixed
with regression tests. The efficiency pass led to digest/payload reuse,
offline completed-cache operation and resource bounds. Exact duplicate boxes
are also excluded from assignment while still counting as false positives.

Review JSON: `/tmp/compound-engineering/ce-code-review/ftd-difficulty-20260908/review.json`.
No unresolved local code findings were retained after applying these fixes.

## Analysis

Worktree creation was refused at 20.9 GiB free against a configured 30 GiB
minimum. The user explicitly authorized continuing in the existing checkout.
Changes remain local and uncommitted on `main`; unrelated dirty work was
excluded from edits and review. No attempt was made to bypass the disk rule.

The provider adapter deliberately does not use the shared automatic-retry LLM
wrapper: an ambiguous paid timeout must not silently cause another charge.
It uses the existing metering module. A missing/invalid provider cost stops
the run; price-sheet reservations are never substituted for actual spend.

## Gaps

### Completion-bottleneck revision (user correction)

- Completed: replace average-heavy score with 80% maximum dog miss rate,
  15% hardest-three mean, 5% overall mean. Record score version separately
  from inference configuration so completed detection caches stay reusable.
- Completed: expose bottleneck and never-matched dog IDs; flag saturated
  bottlenecks. Remove count/size difficulty tie-breakers; ID is display only.
- Completed: regression exercises real box matching on 25 dogs and verifies
  one never-found dog outranks all dogs found in only one of three trials.
  Score is 85.2 versus the old 12; all-found and all-missed boundaries hold.
- Verification: 63 targeted tests passed; Ruff passed. Inline scoped review
  checked score bounds, fewer-than-three behavior, cache independence, IDs,
  saturation warnings and documentation. No provider calls or source art edits.
- Completed: inspect all 26 Waterfall target context crops. Visual bottleneck
  candidates are dog_03 (mossy rocks), dog_01 (tiki-side vegetation), dog_08
  (ground and vegetation). User feedback establishes Waterfall is hard;
  its exact relative rank is not established by this inspection.
- Revised report: `astra-visual-ranking-v2.html` and JSON. Waterfall moved
  from #3 to tentative #9 in the hard band. Other scenes have not received
  the same exhaustive per-target audit; this is disclosed in the report.
  Local desktop rendering and crop evidence inspected; all 10 rows and
  33 images loaded, mobile layout had no horizontal overflow.

### Astra and Portal follow-up

- Added exact `openai/gpt-6-astra` support, omitted unsupported temperature,
  and reserved against the highest published pricing tier including cache writes.
- Full targeted suite: 62 tests passed; Ruff and `git diff --check` passed.
- `astra-preflight.json` records a no-spend public catalog preflight. Paid
  provider execution remains unverified.
- `astra-visual-ranking.json` and `astra-visual-ranking.html` contain a separate
  interactive qualitative assessment of all 10 pilot scenes and central crops.
  This is not detector output or measured player difficulty.
- Published to https://portal.basegamelab.com/s/ftd-difficulty-ranking-20260908
  (post `p_16f251`). Authenticated hosted report returned 200, rendered 10 rows
  with all images loaded, and expanded evidence correctly. Desktop and mobile
  local layouts were inspected; mobile had no horizontal overflow.
- See `portal-verification.json`. Portal requires an existing login; no access
  token is embedded in the report or shared URL. No live level order changed.

- No paid live call: account access, actual provider acceptance of the request
  schema/price limits, and real response/metering behavior are not yet proven.
- Thumbnail detection is an uncalibrated whole-scene proxy. No real-device
  visual acceptance, measured completion-time fit, occlusion/camouflage judge,
  or player telemetry analysis is claimed.
- The output is a proposed ranking, never an applied level sequence. Sprite
  rectangles can differ from visible dog bounds and can cause matching errors.

## Next Action

With explicit paid-run authorization and a budget, execute this frozen pilot
into a fresh scorer-owned output directory, inspect real detections and costs,
then calibrate the proposed ranking against gameplay before changing order.
