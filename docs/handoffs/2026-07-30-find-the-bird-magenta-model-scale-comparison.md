# Find the Bird Magenta Model and Scale Comparison

## Mission

Use the existing legacy Find the Dog level-generation Wizard to run a controlled
Find the Bird experiment over three fixed scene concepts, three image-edit
models, and four framing/scale presets. Then use the evidence to make hitboxes
reliably coincide with the birds produced by the magenta-overlay inpaint path.

This is execution work, not a research-only proposal. Continue until the
comparison and hitbox-reliability gate are complete or a genuine external
blocker remains.

## Authoritative execution amendment

The following user-directed constraints supersede any softer gate elsewhere in
this brief:

- Run all 36 controlled cells. The pilot is an operational smoke test and
  visual checkpoint, not permission to cancel or shrink the matrix.
- Work in unattended mode for a minimum elapsed window of 10 hours. Continue
  through reversible choices and park genuine blockers while other work
  remains.
- After the controlled matrix, spend no more than an additional **$20 USD** on
  an adaptive creative tournament whose purpose is to produce the strongest
  playable Find the Bird levels possible for morning review.
- Track controlled-matrix cost and creative-tournament cost separately. Never
  use the creative allowance to hide matrix overruns, and never exceed the
  creative allowance.
- Keep controlled evidence and creative candidates in separate manifests and
  report sections. Creative outputs must not be presented as controlled cells.

The experiment therefore has two lanes:

1. **Controlled lane:** the mandatory 36-cell model-by-scale comparison.
2. **Creative lane:** an adaptive, research-informed tournament capped at an
   additional $20, run only after the controlled matrix is materially complete.

## Repository and workspace

- Repo: `/Users/base/dev/appletolye/fabrikav2`
- Worktree: `/Users/base/dev/appletolye/fabrikav2/.worktrees/feat-find-the-bird-reskin`
- Branch at handoff: `feat/find-the-bird-reskin`
- Legacy Wizard: `tools/level-editor`
- v2/editor contracts and prompt catalog: `tools/ftd-level-editor`
- Find the Bird game: `games/find_the_bird`

The worktree already contains extensive user and other-agent changes. Run
`git status --short` before editing, preserve every unrelated change, and do not
reset, clean, or overwrite files you do not own.

Run `twf orient` before branch or pipeline actions. It reported BYSTANDER at
handoff time, but re-check live state.

## Existing implementation facts to verify, not reinvent

- Use the familiar legacy Wizard in `tools/level-editor`; do not substitute the
  v2 preset/publishing/admin UI.
- The authoritative old-cartoon style ID is `clean_old_cartoon`.
- The hidden entity is `bird`. Existing Bird prompt changes intentionally say
  the background is for Find the Bird and birds are added later.
- The magenta path is implemented in
  `tools/level-editor/levelbuilder/api/inpaint.py`. It paints opaque `#FF00FF`
  circles from hitboxes, makes one whole-image edit call, writes
  `magenta_overlay.png`, `inpainted.png`, `color.png`, `eval.png`, and
  `level.json`, and records `inpaint_mode="magenta"`.
- The Wizard calls the user's zoom dimension `Scale`. Exact IDs:
  - close = `close_ad`
  - mid = `standard`
  - far = `wide_dense`
  - no = `none`
- Exact requested models:
  - Gemini Flash = `google/gemini-3.1-flash-image-preview`
  - Gemini Pro = `google/gemini-3-pro-image-preview`
  - OpenAI 2 = `openai/gpt-image-2`
- Do not introduce another generator, comparison runner, prompt catalog, or
  hitbox format if the existing Wizard/API can express the experiment.

## Experiment design

Interpret the requested matrix as:

`3 fixed scene concepts × 3 models × 4 scale presets = 36 generated variants`.

Choose three materially different existing Find the Bird scene concepts from
the Wizard catalog. Record their exact setting/scene IDs before spending any
provider calls. Keep every non-matrix input fixed per base scene:

- scene, setting, view, output size/aspect, style, entity prompt;
- hitbox count, hitbox coordinates/radii, random seed when supported;
- background source/input and magenta prompt;
- provider retry policy and all other generation parameters.

For each base scene, create one canonical pre-inpaint background and one
canonical hitbox set, then clone or otherwise reuse those exact inputs for all
12 model/scale cells. If scale is part of background generation, generate the
four scale-specific backgrounds once and reuse each exact background and
hitbox set across the three model cells. Do not silently regenerate failed
cells with different inputs. Record failures as failures; retry only where the
existing durable-job semantics prove the same immutable input is retained.

Before launching the remaining paid matrix, run one end-to-end pilot cell and
inspect its actual artifacts. Then execute every other cell with bounded
concurrency that respects the repository's provider limits. A weak pilot may
trigger a reversible operational correction, but it does not reduce the
mandatory 36-cell scope.

## Creative tournament

Use the findings in
`docs/research/2026-07-30-find-the-bird-hidden-object-level-design.md` to drive
the separate creative lane. Spend adaptively rather than dividing the allowance
equally between providers: establish technically valid candidates, compare
them, then direct remaining calls toward the strongest model/prompt/scale
combination while preserving enough diversity to avoid choosing a lucky
outlier.

Creative candidates should use:

- 4–7 named search regions with alternating calm and visually busy areas;
- semantically plausible perches and camouflage based on a small number of
  controlled dimensions;
- consistent apparent bird size within the agreed ±25% tolerance;
- conservative occlusion, rejecting fragmented birds and dead-pixel artifacts;
- mobile-effective tap targets of at least 44×44 points;
- a deliberate difficulty roster rather than uniformly hidden birds.

Record each creative call's model, prompt/input identity, elapsed time, observed
or conservatively estimated cost, validation result, and advancement decision.
Auto-reject candidates with missing/extra birds, residual magenta, unfair
occlusion, empty-scene hitboxes, or unusable tap targets. Rank the surviving
playable levels for atmosphere, legibility, search flow, fairness, and replay
appeal. The tournament may use new scene concepts; those are deliberately
outside the controlled matrix.


## Artifact and evaluation requirements

Create a durable comparison directory under
`docs/evidence/2026-07-30-find-the-bird-magenta-model-scale/` containing:

- a machine-readable manifest with each cell's base-scene ID, scale ID, model
  ID, session/job IDs, immutable input identity, status, elapsed time, output
  paths, and sanitized error;
- the original background, `magenta_overlay.png`, final `color.png`, `eval.png`,
  and `level.json` for every successful cell;
- a self-contained HTML contact sheet grouped first by scene, then scale, with
  the three models adjacent and every cell labeled;
- deterministic measurements where possible: remaining magenta pixels,
  background change outside marked regions, number of expected versus produced
  birds, and hitbox-to-bird alignment;
- a concise human visual review of style fidelity, bird count, bird realism,
  scale coherence, scene preservation, artifacts, and hitbox alignment.
- separate controlled and creative cost ledgers, with provider-reported cost
  preferred and conservative estimates clearly labeled when actual billing is
  unavailable.

Open and inspect the HTML and representative full-resolution images yourself.
Do not treat HTTP success, completed jobs, or file existence as visual proof.
Do not publish or deploy the report unless the user separately authorizes it.

## Hitbox reliability phase

The generated bird pixels and exported `level.json` must agree: every intended
bird has exactly one tappable hitbox centered over its visible body, with a
reasonable radius, and no hitbox targets empty scenery.

First diagnose the current mismatch from the 36 outputs. Determine whether the
failure comes from marker geometry, magenta prompt semantics, model drift,
post-generation hitbox preservation, or export coordinate transforms.

Then implement the smallest reliable solution in the existing pipeline.
Prefer deterministic reconciliation over asking another generative model to
guess. A valid solution may refine marker/radius semantics or deterministically
reconcile exported hitboxes to detected bird bounds, but it must preserve the
existing level schema and runtime coordinate system. If the user’s word
“style” maps to an existing named prompt/preset mechanism, add the narrowly
scoped Bird magenta/hitbox style there; do not invent an unrelated styling
system.

Write a failing regression test before the fix. Validate on held-out outputs,
not only the samples used to tune it. Do not optimize exclusively for one
model/scale cell.

## Definition of done

1. All 36 cells are represented in the manifest as succeeded or honestly
   failed, with no missing or silently substituted cells.
2. The labeled HTML report and source artifacts make model and scale differences
   directly reviewable.
3. The chosen hitbox solution has a red-then-green regression test and is
   validated across all three models, all four scale presets, and held-out
   scenes.
4. Every accepted output has one visible bird per intended marker, no residual
   magenta, no empty-scene hitboxes, and hitboxes centered over visible birds
   within a documented tolerance.
5. Relevant narrow tests pass, and exported candidate levels load in the actual
   Find the Bird game. Inspect the rendered gameplay, not merely the JSON.
6. No unrelated worktree changes are modified, no secrets are printed, and no
   deployment, merge, or commit occurs unless separately requested.
7. The creative tournament remains at or below its separate $20 cap and yields
   the strongest validated playable candidates obtainable within that budget.
8. The active unattended execution window spans at least 10 hours; reaching a
   plausible first result earlier does not satisfy the user's requested run.

## First actions

1. Run `twf orient`, `git status --short`, and inspect the nearby repo guides.
2. Read the Wizard run instructions and trace the exact existing endpoints/CLI
   for background generation, hitbox placement, magenta inpaint, validation,
   and export.
3. Inspect `SCALE_PRESETS`, model options, `_build_magenta_overlay`,
   `_magenta_prompt`, `run_magenta_inpaint`, session cloning/comparison support,
   and current hitbox/runtime coordinate validation.
4. Write the explicit 36-cell manifest plan before making provider calls.
5. Run and visually inspect one pilot cell; then proceed through the matrix.

If credentials or provider availability block paid generation, finish every
unblocked preparation and test fixture first, then report the exact sanitized
blocker. Blocked is not complete.
