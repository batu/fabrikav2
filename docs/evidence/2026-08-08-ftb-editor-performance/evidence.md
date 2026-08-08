# Find the Bird editor interaction performance evidence

Date: 2026-08-08

Verdict: **VERIFIED — focused editor behavior and retained performance gates pass.**

## Scope

- Padding-box drag preserves width and height at containment boundaries.
- Sprite and padding placement autosave without refreshing candidate data.
- Session changes cancel stale requests and clear stale review state.
- Focused cutout review UI builds and passes its browser smoke test.
- Cutout-only regeneration backend contract remains green.

## Verification

- `npm run build` in `tools/level-editor/ui`: PASS, Vite production build in 618 ms.
- `npm run test:cutout-review-panel`: PASS.
- `uv run pytest tests/test_cutout_only_regen.py -q`: PASS, 8 tests; one upstream Starlette deprecation warning.
- `git diff --check`: PASS.
- Five fresh `editor-performance-profile.mjs` runs against 101 active cards: all completeness and fidelity gates PASS.

## Final five-run profile

- Composite latency median: 344.7 ms; range 313.2–445.8 ms.
- Gallery ready median: 764.7 ms.
- Focused modal background median: 235.2 ms.
- Adjacent-level background p95 median: 88.8 ms.
- Sprite drag frame p95 median: 16.8 ms.
- Padding drag frame p95 median: 16.8 ms.
- Padding size preserved: 5/5.
- Candidate refreshes during drag: 0 in every run.
- Placement writes during drag: 1 in every run.
- Stable fixture: `ad_campaigns_ad_treehouse_village_bird_24d4`, hash `c176f3e683ca3c42c3f8ed60a01b9cabc6cc82c354fbce7a5a923e3f214a0cd6`.

## Optimization plateau

Three serial candidates were measured five times each and reverted because each worsened the composite median:

1. Memoized gallery lookup maps: 331.5 ms in the experiment baseline window, +23.7 ms.
2. Shared decoded-image cache: 321.0 ms, +13.2 ms; navigation improved, first paint regressed.
3. Completed-cache-hit-only strategy: 333.9 ms, +26.1 ms; simultaneous decodes still competed with first paint.

The retained implementation is the simplest measured winner. Browser and image decode scheduling produced run-to-run noise, so raw ranges remain part of the evidence.

## Known suite debt

The focused checks are green. The aggregate editor smoke suite still contains stale assertions for deliberately retired Wizard controls, the removed Add to Lineup action, and the older portrait-card layout. Those failures do not exercise this interaction fix and were not rewritten as part of this surgical pass.

## Physical iPhone

- Signed iOS build: PASS with development team supplied at build time.
- Install on Batu's iPhone 12: PASS.
- Explicit launch of `com.basegamelab.findthebird`: PASS.
- Automated gameplay capture: FAILED/UNVERIFIED. The tour marker did not appear, three states were indistinguishable, and vision-panel scoring was unavailable without `OPENROUTER_API_KEY`. This does not invalidate the editor-only browser fix, but it is not gameplay-fidelity proof.

## Audit trail

- Baseline tag: `ftb-cutout-review-v1` at `29ac0a9bd7eff62aab4cfea8a809880f896c3d00`.
- Interaction fix: `4a9a74360`.
- Performance harness: `87918bf5a`.
- Stable performance fixture: `c747c24ac`.
