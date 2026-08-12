# Review verdict

**Proceed with amendments.**

The architectural direction is sound, but the plan overstates what Phase 1 achieves. As written, it removes projection drift from three API surfaces while leaving the same failure class in the primary session payload, overlay rendering, gallery aggregation, generation internals, repair tooling, and evaluation.

## 1. Canonical-first reads do not yet eliminate projection drift

Phase 1 currently **moves and narrows** the drift boundary; it does not eliminate it.

### The main editor state remains legacy-derived

`GET /sessions/{id}` calls `hydrate_session()` and only appends canonical revision identifiers afterward ([routes.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:1144)). Hydration still obtains:

- dogs, IDs, active variants, and status from `session.json` plus `dogs/` folders ([session.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2966))
- hitboxes from `hitboxes.json` ([session.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:3032))

The panel uses that `session.dogs` and `session.hitboxes` for active-candidate selection and crop targeting. Consequently, a canonical save can appear in `/sprite-candidates` yet still disagree with the rest of the editor.

**Required amendment:** add a `VALID_CURRENT` branch to `hydrate_session()` that overlays all canonically governed fields—bird identity, compatibility slot, active generation/variant, sprite geometry, flips, cleanup, and hitboxes—from the snapshot. Alternatively, narrow Goal 1 to the candidate-review surface and admit that compatibility projection remains required elsewhere.

### Snapshot validity does not prove asset validity

Canonical validation checks that asset descriptors contain syntactically valid `path`, `sha256`, and `bytes` fields ([canonical_bird_contract.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/canonical_bird_contract.py:97)). It does not verify the referenced file’s containment, existence, size, or digest when returning `VALID_CURRENT` ([canonical_bird_contract.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/canonical_bird_contract.py:275)).

Thus canonical metadata can be internally valid while the mutable file has been deleted, overwritten, or replaced. That is still a “saved but not what is displayed” failure—between snapshot metadata and asset bytes instead of between snapshot and sidecar.

**Required amendment:** introduce one canonical asset resolver that verifies:

- path containment
- existence and allowed media type
- declared byte count
- SHA-256 digest

Use it in candidates, readiness, overlay/asset serving, generation promotion, and export. Expand the regression test to delete/replace an asset and assert an integrity error, not a successful stale response.

## 2. Hidden legacy/compatibility consumers missed by the plan

P1.4’s target of “export lane and nothing else” is currently false.

### Runtime/editor consumers

- Candidate overlay requires `metadataPath`, rereads `spriteBox`, cleanup, and flips from the sidecar, and fails without it ([routes.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:1207)). The UI invokes this overlay directly ([CutoutReviewPanel.tsx](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:197)).
- Candidate placement and confirmation first rediscover the bird through `sprite_animation_candidate_by_id()` ([routes.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:1384), [routes.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:1480)).
- Gallery aggregation counts human confirmations and regeneration candidates by globbing every `dogs/dog_*/sprite_*.json` ([session.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2590)).
- `repair_cross_bird_padding()` reads `session.json` active variants and candidate sidecars, then directly rewrites sidecars and `level.json` ([session.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:766)).
- Golden-review creation and legacy-currentness checks inspect `level.json` sprites and sidecars ([session.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:1058), [session.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:1159)).

### Generation consumers

- Auto-placement reads the candidate sidecar, `session.json` dogs, `hitboxes.json`, and every neighboring sprite sidecar ([inpaint.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:4471), [inpaint.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:4521)).
- Sprite-only composition requires the sidecar’s `quality`, `spriteBox`, and `cleanupBox` ([inpaint.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:5063)).
- Recenter/cleanup repair reads and mutates positional `sprite_000.json` files ([inpaint.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:5894)).
- Canonical retry capture still translates bird IDs into compatibility-slot indices ([inpaint.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:4301)).

### Offline/tooling consumers

- Sprite evaluation reads exported `level.json` plus sprite sidecars for source boxes ([sprite_eval.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/sprite_eval.py:798)).
- Golden placement dataset loading reads sprite sidecars directly ([golden_cutouts.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/golden_cutouts.py:546)).
- `corpus_migration` legitimately consumes `session.json`, `hitboxes.json`, sprites, and sidecars when importing legacy sessions ([corpus_migration.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/corpus_migration.py:655)).

**Required amendment:** add a checked-in consumer matrix classifying every access as:

- canonical runtime read
- canonical generation input
- legacy-only authoring read
- migration/import read
- exported-package/evaluation read

Projection cannot be removed until every canonical runtime/generation consumer has been converted. Exported-package and explicit legacy tooling may legitimately retain the compatibility format.

## 3. Phase 2’s legacy boundary is unsafe as specified

Directory existence is not a sufficient state classifier.

The canonical store distinguishes:

- `VALID_CURRENT`
- `MIGRATION_REQUIRED`
- `ORPHANED_STAGE`
- `QUARANTINED_INTEGRITY`

([canonical_bird_contract.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/canonical_bird_contract.py:275)).

Current retry routing enters the canonical branch only when both snapshot and pointer are populated. An orphaned or quarantined footprint has neither, so it can fall through to the legacy request path ([inpaint.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:4250)).

Use an explicit state table:

| State | Allowed lane |
|---|---|
| `VALID_CURRENT` | Canonical request required |
| `MIGRATION_REQUIRED`, with no canonical artifacts | Legacy |
| `ORPHANED_STAGE` | Fail closed |
| `QUARANTINED_INTEGRITY` | Fail closed |
| Any ambiguous/partial canonical footprint | Fail closed |

The UI must select this lane using authoritative `canonicalState`, not the current condition “revision, `birdId`, and crop box happen to exist.” Today that condition silently sends the legacy request shape otherwise ([CutoutReviewPanel.tsx](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:604)).

## 4. Phase 3 deletion risks are understated

### `corpus_migration` does not replace stable-ID backfill

`corpus_migration` requires IDs already present and matching in `session.json` and `hitboxes.json`; otherwise it quarantines the session ([corpus_migration.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/corpus_migration.py:699)).

`backfill_stable_ids` uniquely:

- performs geometric binding
- detects permutations and ambiguous matches
- stamps safe stable IDs
- preserves originals outside the authorized files

([backfill_stable_ids.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/backfill_stable_ids.py:93), [backfill_stable_ids.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/backfill_stable_ids.py:121)).

Deleting it retires a recovery capability; it is not merely deleting duplicate migration machinery.

### The classifier is not an isolated 80-line function

`integrity_audit` imports `classify_session()` ([integrity_audit.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/integrity_audit.py:66)), but that classifier depends on `prepare_migration_session`, geometric rebinding, issue-code semantics, permutation checks, readers, and checksums from the two modules slated for deletion.

Copying the visible classifier risks silently weakening quarantine decisions.

### The corpus gate is too narrow

“Find the Dog is canonical or frozen” does not prove:

- no other authoring root contains `MIGRATION_REQUIRED` sessions
- arbitrary-root CLI recovery is no longer needed
- public-only or quarantined sessions are recoverable
- classifier behavior survives extraction
- documentation or operator workflows no longer invoke the scripts

**Required Phase 3 gates:**

1. Census every configured authoring/public root, not only Find the Dog.
2. Record each noncanonical session as migrated, deliberately frozen with an owner, quarantined, or recoverable by the retained engine.
3. Add parity fixtures for clean, permuted, ambiguous, partial-stamp, empty, quarantined, and arbitrary-root cases.
4. Decide explicitly whether safe-ID stamping is retired or moved into `corpus_migration`.
5. Wire and test `restore_verified_*` before deleting its source machinery.
6. Run import, CLI, documentation, and test reachability checks after extraction.

## 5. Ordering mistakes

The dangerous ordering is deleting/demoting projection in Phase 1 before converting generation internals in Phase 2.

Recommended dependency order:

1. Add the canonical-state classifier and canonical asset resolver.
2. Add canonical overlay behavior to `hydrate_session`.
3. Convert candidate listing, readiness, asset serving, overlay rendering, gallery aggregation, and candidate lookup.
4. Convert generation/auto-placement/composition/recenter consumers and enforce the Phase 2 request boundary.
5. Run API plus live regeneration/export tests.
6. Only then demote/remove `project_canonical_bird_compatibility`.
7. Implement review restoration and classifier-parity fixtures.
8. Run the complete corpus/capability census, then perform Phase 3 deletion.
9. Run mechanical pruning after its producing phases have landed.

Phase 4 is largely independent and may run after Phase 1’s API contract stabilizes, but its Portal cutover remains an atomic cross-repo deployment.

Also replace P1.5’s “every canonical write path” wording: it currently enumerates only geometry, promote-with-scene, and confirmation despite other canonical mutations. Either call these “the three phantom-save paths” or enumerate all canonical write APIs.

## Verdict

**Proceed with amendments**, specifically:

- canonicalize the main session read surface
- add verified canonical asset resolution
- inventory and convert all canonical runtime/generation sidecar consumers
- define Phase 2 by canonical state and fail closed on damaged footprints
- move projection deletion after generation conversion
- preserve or explicitly retire stable-ID recovery
- require classifier parity and a repo-wide corpus/caller census before Phase 3
- make review restoration a prerequisite, not a cross-cutting aspiration
- replace the phase list with an explicit dependency order

Without those amendments, Phase 1 fixes the observed phantom-save incident but leaves the underlying projection-drift failure class active.

Reviewers run: coherence, feasibility, and adversarial architecture.

