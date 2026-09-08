# Find the Dog automatic difficulty ranking

Status: research complete; no scoring calls, level changes, or live sequence changes made.

## Verified existing capabilities

- `uv run level-editor --help` has no difficulty scoring or ranking verb. The CLI is a thin HTTP client; extend this existing interface rather than create a separate pipeline. Sources: `tools/level-editor/README.md`, `tools/level-editor/levelbuilder/cli/main.py`.
- `visibility-check` invokes `mobile_visibility_report`: geometry against mobile viewports, cropping, HUD and safe areas. The README's contrast-report description is misleading; this is not camouflage measurement. Sources: `levelbuilder/cli/main.py:582`, `levelbuilder/api/routes.py:2588`, `levelbuilder/api/session.py:3828`, relative to `tools/level-editor/`.
- Smart placement uses `google/gemini-3.6-flash` to score candidate hiding locations before painting. These scores cannot substitute for finished-level difficulty. Source: `tools/level-editor/levelbuilder/api/smart_hitboxes.py:30`.
- Existing `detect_birds_vlm` reads the session entity and detects it on the painted image. It defaults to Gemini 3.6 Flash, resizes to 1024x1024, and records usage. Reuse provider/schema/metering patterns, but preserve aspect ratio and define evaluation resolution explicitly. Do not invoke placement mutation commands as scoring tools. Source: `tools/level-editor/levelbuilder/api/inpaint.py:5993`.
- Ordering already has a sequence draft and dry-run API; activation routes shown in the old sequence workflow are retired. Use the supported release workflow for publication. Sources: `tools/level-editor/levelbuilder/api/routes.py:4282`, `:4305`, `:4325`; runtime consumer `games/find_the_dog/src/sequence/runtimeSequence.ts`.
- Analytics defines runtime `dog_found` with `time_since_start`, plus runtime hint use. Some other desirable events are only marked contract. Production data availability was not checked. Sources: `games/find_the_dog/src/analytics/CanonicalAnalyticsEvents.ts:160`, `games/find_the_dog/src/scenes/GameSceneAnalytics.ts`.

## Model verification

The background research agent verified official Google documentation: stable model ID `gemini-3.8-flash` supports image input, text output, structured JSON and Batch API. OpenRouter availability and account access were not verified; do not assume a provider-prefixed ID is available simply because Google lists the model.

Sources: [model specification](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [image understanding](https://ai.google.dev/gemini-api/docs/image-understanding), [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).

## Recommended measurement experiment

This is a proposed proxy for human search difficulty, not a validated model of completion time.

1. Freeze the intended sequence's level IDs, artwork and target hashes, and gameplay viewport/zoom rules. Exclude invalid or unreachable targets from ranking and flag them for repair. Keep approved content and placements intact.
2. Measure deterministic features: target count, visible painted target area at gameplay scale, search area/sections, local contrast and clutter. Hitbox radius is not painted dog size; sprite-derived masks need quality checks before using them to measure visible target pixels.
3. Run three independent blind Gemini evaluations per level on unannotated gameplay-equivalent views, with identical prompt, model, resolution and thinking settings. Do not expose hitboxes, target coordinates, crops or expected count in the blind pass. Match returned boxes one-to-one against ground truth using explicit geometry tolerances; record per-dog detection frequency and false positives. Matching errors and model misses need separate diagnostics.
4. In a separate call, provide scene context and target crops for explanations of camouflage, occlusion and recognizability. Those informed judgments must not contaminate blind-detection measurements. Treat self-reported confidence and model response latency as unsuitable substitutes for human search time.
5. Produce a provisional ascending ranking with per-level median target difficulty, hardest-tail difficulty, target count/search workload and uncertainty. Avoid averaging away one near-impossible last dog. Start with rank-based components and explicitly provisional weights; calibrate against first-attempt human completion times, final-dog delays and hint use, controlling for sequence position, experience and viewport. Re-evaluate ties or unstable results rather than claiming an exact order.

High-resolution detection may saturate at nearly perfect recall: the earlier ladder handoff already reports that phenomenon. If so, use gameplay-scale views and richer target features rather than assuming every level is equally easy. Source: `docs/handoffs/2026-08-15-dog-difficulty-ladder.md`, Findings 2. That handoff is historical experimental evidence, not current corpus validation.

## Smallest useful next implementation

Add read-only scoring/report operations to the existing level editor CLI and backend, with explicit model, input hash cache, bounded repeats and actual provider usage recording. Pilot on 10 diverse existing levels, inspect easy/middle/hard cases on a real phone, then expand only after the proxy produces defensible distinctions. Proposed command names must be documented as new, not existing CLI verbs.

Output a reviewable proposed order first. Apply an accepted order through the existing revision-checked sequence draft and dry-run workflow, preserving level identities, approval state and any mandatory starter-prefix constraints. Publication remains a separate action.

Before paid evaluation, verify provider model availability without generation, set a hard budget and record the selected configuration. No paid evaluation was authorized or executed during this research.
