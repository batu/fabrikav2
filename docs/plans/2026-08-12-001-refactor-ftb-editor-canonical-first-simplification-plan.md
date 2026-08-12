# FTB Editor: Canonical-First Simplification & Robustification Plan

**Date:** 2026-08-12 · **Status:** PROPOSED, amended per codex review (verdict: proceed with
amendments — `docs/reports/2026-08-12-ftb-editor-codex-review/`) · **Prereq reading:** today's
incident chain (commits `924439a26..15402b1af`)

## Why now

One day of real editing on canonical sessions surfaced six defects with a single root cause:
the canonical store became the write-side truth while every read surface (sprite candidates,
review readiness, the asset endpoint, recenter, exports of intermediate state) still consumes
the legacy compatibility files (`dogs/<slot>/sprite_XXX.{png,json}`, `hitboxes.json`,
`session.json` dogs). The seams are stitched by hand-written projections; every unstitched
seam is a future "it said saved but nothing changed."

Secondary root causes, same family: two deploy surfaces (API process vs `ui/dist`), and two
addressing schemes (stable bird id vs positional slot index) used interchangeably.

## Goals

1. **One truth for reads.** A canonical session is read through its snapshot, full stop.
2. **Delete, don't maintain, the dead half.** Legacy lanes exist only where a legacy corpus
   still needs them, behind one explicit boundary.
3. **Every "saved" is observable.** No write path may return success unless the surface the
   editor re-reads reflects it.
4. **Single deploy surface.** A restart ships the current editor, by construction (guard
   already landed; finish the job by removing the second copy).

## Non-goals

- No storage format changes; the canonical revision store stays as-is.
- No new features. This plan removes code and adds invariants.
- find_the_dog corpus migration is out of scope (Phase 3 gates on it).

## Phase 1 — Canonical-first reads (the payoff phase)

**P1.1** `sprite_animation_candidates`: when the session is `VALID_CURRENT`, build candidates
from the snapshot (geometry, image path, flips, confirmation from `candidateReviews`), using
sidecars only for fields canonical does not govern (quality diagnostics, regeneration review).
Non-canonical sessions keep the sidecar path unchanged.
**P1.2** `get_final_cutout_review_readiness`: for canonical sessions, readiness = snapshot
completeness (every bird has a sprite asset on disk). Delete the sidecar-walk for that branch.
**P1.3** `sprite_candidate_asset` endpoint: resolve through the snapshot's asset path first
(job-artifacts included), sidecar path as fallback.
**P1.4** Demote `project_canonical_bird_compatibility` to exactly what still needs it after
P1.1–P1.3 (target: export lane and nothing else), then inline or delete it.
**P1.5** Regression: a test that commits via every canonical write path (geometry, promote
with scene, confirmation) and asserts the *API responses* (not files) reflect the commit —
the phantom-save class, pinned at the contract level.

Exit criteria: kill the projection sweep; `grep -c project_canonical_bird_compatibility` ≤ 2;
phantom-save test green.

## Phase 2 — One generation lane

**P2.1** `_start_retry_failed_dogs_job_record`: require canonical (`birdIds` +
`expectedContentRevision`) when the session has a canonical store; the legacy
`dogIndices`/blessed-hitboxes branch survives only for sessions with no `.canonical` dir,
and logs loudly when taken.
**P2.2** UI `runCandidate`: drop the legacy request shape for canonical candidates (it exists
today only as a fallback that immediately 409s and retries — send canonical or fail).
**P2.3** Delete the `hitboxesSha256` staleness plumbing from the canonical path (provenance
verification already covers it; two gates, one meaning).

## Phase 3 — Shrink the migration machinery (~1,400 lines)

**Gate:** confirm the find_the_dog corpus is either already canonical or explicitly frozen.
**P3.1** Extract `_stable_uuid` + `_public_dog_id` into a small `stable_ids.py` (the only
live imports from `canonical_migration` besides the audit classifier).
**P3.2** Fold the audit's legacy-identity classifier into `integrity_audit.py` (read-only
evidence needs ~80 of `backfill_stable_ids`'s 296 lines).
**P3.3** Delete `canonical_migration.py` and `backfill_stable_ids.py`; `corpus_migration.py`
is the one migration engine (it already handles plan/apply/journal/quarantine/refresh/import).

## Phase 4 — One deploy surface

**P4.1** Backend mounts `ui/dist` (static + index) behind the existing port; portal's
`/tools/ftd-editor` becomes a pure reverse proxy (it already proxies `/api`).
**P4.2** Delete the portal's static-file serving of the editor and its cache workarounds.
**P4.3** Keep the launch-time build guard; add the dist content hash to `/api/config` so a
mismatched UI is detectable in one request.

## Phase 5 — Surface pruning (mechanical)

Dead editorApi exports (15), the always-410 `DELETE /catalog/levels/{id}` stub, knip-confirmed
UI files as they fall out of Phases 1–2, duplicate `checksum_tree`.

## Robustification (cross-cutting, lands with each phase)

- **R1. Slot vs id lint:** one helper for hitbox↔dog binding (by id, positional fallback
  with a logged warning); ban raw `hitboxes[index]` / `dog_{i:02d}`-from-enumerate patterns
  by convention note and a grep-based test.
- **R2. Fail loud on unpersistable writes:** any endpoint that cannot persist (missing
  session, package-only level) returns an error — never `{ok: true}`. The archive and
  hitbox-review silent no-ops were both this bug.
- **R3. Live shakedown protocol:** any new integration seam ships with one recorded live run
  (project rule already; the canonical regen scene-commit lane still owes its first live run).
- **R4. Review-preservation tests** stay mandatory for every representation change
  (policy #11; the promotion sweep exists — wire `restore_verified_*` into migration apply
  so over-invalidation self-heals instead of needing an operator).

## Order & estimates

Phase 1: ~1 day. Phase 2: ~half day. Phase 4: ~half day. Phase 3: ~half day after its gate.
Phase 5: riding along. Each phase lands green (`uv run pytest`, tsc, panel+gallery+golden-path
smokes) and restarts the backend through `run-backend.sh`.

## Amendments from codex review (binding)

**A1. Phase 1 scope was understated.** Canonical-first must also cover `hydrate_session()`
(the main `GET /sessions/{id}` payload still derives dogs/hitboxes from legacy files), the
candidate overlay endpoint (rereads sidecars), gallery aggregation (globs sidecars for
confirmation counts), and candidate lookup (`sprite_animation_candidate_by_id`). Ship a
checked-in **consumer matrix** classifying every sidecar/`session.json`/`hitboxes.json` read
as canonical-runtime / generation-input / legacy-authoring / migration / export-evaluation.
Projection is deleted only after every canonical-runtime and generation consumer converts.

**A2. Canonical asset resolver.** Snapshot validity does not prove asset validity. One
resolver verifies path containment, existence, byte count, and sha256; used by candidates,
readiness, asset serving, overlay, promotion, export. Regression test deletes/replaces an
asset and asserts an integrity error, not a stale success.

**A3. Phase 2 lane selection by canonical STATE, not directory existence.**
`VALID_CURRENT` → canonical required; `MIGRATION_REQUIRED` with no canonical artifacts →
legacy; `ORPHANED_STAGE` / `QUARANTINED_INTEGRITY` / partial footprints → fail closed. The UI
selects the lane from the authoritative `canonicalState`, not "revision+birdId happen to
exist."

**A4. Phase 3 gates hardened.** `backfill_stable_ids` is a *recovery capability* (geometric
identity binding), not duplicate machinery — retire it only by explicit decision, with parity
fixtures (clean/permuted/ambiguous/partial/quarantined), a census of every authoring root
(not just find_the_dog), and `restore_verified_*` wired into migration apply first.

**A5. Ordering.** Resolver + state classifier first; `hydrate_session` overlay second; read
surfaces third; generation consumers + lane boundary fourth; live regen/export shakedown
fifth; only then demote projection; census then Phase 3; pruning last. Phase 4 independent
after the Phase 1 API contract stabilizes.

**A6. Contract cleanup (from the code review):** the contract currently conflates "generation
input provenance" with "current-scene binding" (`inputSceneSha256` equality), which forces
scene commits to rewrite history for untouched birds. Split into a provenance field (immutable
per generation) and a scene-binding check. Also: one-active-paid-job-per-bird guard
(nonce dedupes accidental retries but not deliberate cross-client double-spend), recenter
under revision-bound CAS, and an explicit `completed_stale` parent job status when zero units
committed.

## Full-editor review findings (second pass, 2026-08-12 evening)

Three further codex reviews (wizard/generation, gallery/lineup/export, job infrastructure —
same reports directory) added 51 findings. They cluster into four classes that reshape the
phases; the individual findings live in the reports and are not restated here.

**F-A. Wizard geometry writers bypass canonical CAS entirely** (wizard #1–#3, #18–#19; also
jobs #7). Auto-placement, both recenters, VLM placement, magenta finalize/reconcile, and
`/select-bg` write `hitboxes.json`/`session.json` directly on `VALID_CURRENT` sessions — no
expected revision, no snapshot commit, no review invalidation; hydration then prefers the
legacy files. This is the same disease Phase 1 treats, from the write side. **Phase 1 gains a
P1.6: one CAS-aware geometry mutation service used by every writer**, and `hydrate_session`
overlays canonical (amendment A1). Byte-identical saves must not invalidate reviews (#18 —
policy #11 applies to no-op writes too).

**F-B. Publish/lineup can ship a stale revision** (gallery #1–#7). The catalog entry is not
revision-bound to reviewed authoring; Start writes bundle files before activation succeeds;
per-variant archive un-lineups whole sessions; human-review CAS conflicts are retried
blind — the same unsafe pattern removed from extract today. Becomes **Phase 2b: publication
integrity** (revision-bound catalog entries, transactional Start, no CAS-retry on human
approvals), ordered before Phase 4.

**F-C. Job store retries re-bill and transitions are unguarded** (jobs #1–#5, #8; wizard
#7–#8, #13). Requeue erases succeeded children and re-purchases them (the failed-bird lane at
inpaint.py:4793 is the correct model to generalize); `transition_job` is last-write-wins with
no attempt generation; a quick restart can strand `running` jobs forever; magenta runs
side-effectfully inside an SSE generator instead of the durable store. Becomes **Phase 2c:
job-store hardening** (attempt generations + transition graph, succeeded-children retention on
requeue, owner-aware recovery rerun, magenta onto the durable lane).

**F-D. UI state-machine races** (wizard #4–#6, #11, #14–#17; jobs #9–#12; gallery #8, #19).
Debounced saves not flushed before paid submissions, resume pointers droppable, SSE
reconciliation that equates "session readable" with "generation succeeded". Folded into the
existing phases' UI conversions; the flush-before-paid-work rule becomes robustification R5.

Verified against today's incidents: F-A is the mechanism behind this morning's
fix-hitboxes/canonical drift; the gallery blind-retry (#1) is the same pattern that ate
review clicks. The stress battery (isolated rig, ~100 contended ops, SIGKILL mid-burst)
confirms the *canonical CAS + guarded projection* core holds — the failures are all in the
lanes that bypass it, which is the strongest argument for Phase 1/P1.6 being the payoff.

## Pre-execution verification (2026-08-12, done while waiting)

- **Executable defect ledger:** `tests/test_plan_contracts.py` — strict-xfail contract tests
  reproducing four load-bearing findings (bg retry wipes paid child results; requeue accepts
  RUNNING jobs; byte-identical saves revoke reviews; auto-place bypasses canonical). All four
  reproduced. They flip to hard assertions as the phases land; add one per finding fixed.
- **Phase 3 gate — ANSWERED:** find_the_dog corpus census: 105 levels, all
  `public_only/frozen_legacy`, zero authoring sessions. FTB is 100% canonical. No corpus
  anywhere still needs the legacy migration engine; public-only resurrection is served by
  `import_authoring_from_public`. Phase 3's remaining decision is only whether to keep
  `backfill_stable_ids`' geometric rebinding as a cold recovery tool (recommend: move to
  an `attic/` with its tests, out of the import graph).
- **Consumer matrix:** drafted by codex, checked in beside the reports; verify counts during
  Phase 1, not before.
- **Stress battery:** canonical core held (see findings section); rig recipe lives in the
  session scratchpad notes — rebuild: copy one level into a throwaway workspace, run a second
  server with `LEVELBUILDER_WORKSPACE`/`LEVELBUILDER_GAME_ROOT`.

## Risks

- P1.1 changes candidate identity/geometry sourcing — the cutout panel, animation wizard, and
  sprite-eval consume candidates; sweep all three (regression rule #11).
- P3 deletion is irreversible convenience-wise; gate hard on the find_the_dog check.
- P4 touches the portal (separate repo/process); coordinate the cutover in one sitting.
