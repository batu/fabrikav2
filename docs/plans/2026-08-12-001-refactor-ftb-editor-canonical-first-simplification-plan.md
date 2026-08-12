# FTB Editor: Canonical-First Simplification & Robustification Plan

**Date:** 2026-08-12 · **Status:** PROPOSED · **Prereq reading:** today's incident chain (commits `924439a26..15402b1af`)

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

## Risks

- P1.1 changes candidate identity/geometry sourcing — the cutout panel, animation wizard, and
  sprite-eval consume candidates; sweep all three (regression rule #11).
- P3 deletion is irreversible convenience-wise; gate hard on the find_the_dog check.
- P4 touches the portal (separate repo/process); coordinate the cutover in one sitting.
