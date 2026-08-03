# Find the Bird cutout benchmark v1

This directory is the shared measuring stick for cutout-method tickets in
[Wayfinder: clean bird flyout cutouts](https://github.com/batu/fabrikav2/issues/14).
It does not choose a winning method and it does not replace Batu's Portal
verdict.

## Fixed cohort

[`benchmark-manifest.json`](benchmark-manifest.json) pins 20 active birds: one
from each corpus level. It spans 15 portrait 768×1376 sessions and five native
4096×4096 sessions, hitbox radii 22–256, including two r=24 birds. The cases are
tagged for held/worn items, reflective water, dense line art, low contrast,
fine anatomy, and scenery/perch boundaries.

Every entry records both the stable `birdId` and its `dogDir`. The harness reads
`session.json` and `hitboxes.json`, joins dog to hitbox by `id`, then verifies
the index, active variant, coordinates, crop box, dimensions, and files. It
never joins the arrays positionally; tombstone gaps are covered by a regression
test.

The authoring source is read-only:

```text
/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/.levelbuilder/levels
```

## Candidate contract

A method writes RGBA PNGs under its own results root using the manifest's
stable relative layout:

```text
<results-root>/<levelId>/<dogDir>.png
```

For a method with a different layout, pass a format template after `::`.
Available fields are the manifest case fields, including `{caseId}`,
`{levelId}`, `{dogDir}`, `{birdId}`, `{activeVariant}`, `{candidatePath}`, and
`{priorSprite}`. Paths are required to stay inside the declared method root.

## Run

All commands run from the repository root. They read source assets and write
only to the requested output path.

```sh
# Verify all 20 live stable-id joins and pinned source facts.
uv run --project tools/level-editor python \
  docs/evidence/2026-08-03-cutout-benchmark/benchmark_harness.py validate

# Render one or more methods side by side. Repeat --method for more columns.
uv run --project tools/level-editor python \
  docs/evidence/2026-08-03-cutout-benchmark/benchmark_harness.py render \
  --method candidate=/absolute/path/to/method-results \
  --out .work/cutout-benchmark/candidate

# Reproduce the rejected source sprites as a harness smoke test.
uv run --project tools/level-editor python \
  docs/evidence/2026-08-03-cutout-benchmark/benchmark_harness.py render \
  --method 'rejected=/Users/base/dev/appletolye/fabrikav2/games/find_the_bird/.levelbuilder/levels::{priorSprite}' \
  --out .work/cutout-benchmark/rejected

# Resumable Codex pre-filter. Use --case or --limit for a smoke run.
uv run --project tools/level-editor python \
  docs/evidence/2026-08-03-cutout-benchmark/benchmark_harness.py judge \
  --method candidate=/absolute/path/to/method-results \
  --out .work/cutout-benchmark/candidate/codex-prefilter.json
```

`render` emits `sheet-NN.png` pages plus `render.json`. Each row shows the clean
crop, painted crop, and every candidate on the game's shipped `#fff8e8` cream
at up to 2× source pixels. Missing or invalid outputs are visible rather than
silently skipped. The sheets can be attached directly to a Portal `post` or
`report`.

`judge` imports the guarded `SUBJECT_RULE` and `CodexExecJudge` from
`levelbuilder.api.sprite_judge`; it does not maintain a second prompt. The
default pre-filter threshold is subject ≥ 0.8 and completeness ≥ 0.8. Its JSON
explicitly records `humanAcceptanceRequired: true`: passing Codex is only a
cheap filter, never acceptance.

## Verification

```sh
uv run --project tools/level-editor pytest -q \
  docs/evidence/2026-08-03-cutout-benchmark/test_benchmark_harness.py
```

The tests cover the fixed cohort, stable-ID/tombstone joining, manifest drift,
safe method templates, Portal sheet output, and exact reuse of the
bird-plus-held-items rule.
