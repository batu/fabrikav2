I’m using the structured code-review workflow and the prior Find The Bird canonical-store notes. I’ll inspect representative on-disk level instances alongside all three backend readers/writers, then report only plan-changing format defects and the minimal target inventory.

This is a multi-agent review because the format graph spans independent authority boundaries. I’m splitting it into identity/versioning, canonical-store semantics, and published-manifest drift; I’ll independently reconcile all findings against real files before returning the amendments. No files will be changed.

A concrete blocker has emerged: the current catalog and its “immutable” snapshot already contain 163 of 2,268 asset descriptors whose hash/size no longer match the referenced mutable public paths. That changes the refactor target: snapshot immutability cannot be treated as solved merely because snapshot JSON files are append-only.

# FILE-FORMAT review: Find The Bird level pipeline

Verdict: amend the plan before execution. The proposed “canonical store stays as-is” non-goal is unsafe. The current store does not make asset bytes immutable, mixes authored and operational state, and cannot support a reliable canonical-first cutover without format changes.

Three read-only reviewers covered identity/versioning, canonical authoring, and published formats. No files were changed.

## Findings

1. **P0 — Canonical truth can report `VALID_CURRENT` after its referenced pixels have changed**

   Paths:

   - `tools/level-editor/levelbuilder/api/canonical_bird_contract.py:97`
   - `tools/level-editor/levelbuilder/api/canonical_bird_contract.py:288`
   - `tools/level-editor/levelbuilder/api/corpus_migration.py:677`

   Canonical snapshots contain `{path, sha256, bytes}`, but normal reads validate only descriptor shape and snapshot hashes. They do not read and hash the referenced PNGs. Current snapshots point at mutable authoring paths such as `color.png`, `bg_01.png`, and `dogs/dog_NN/sprite_000.png`.

   Replacing one of those files leaves the snapshot, review assertions, and pointer apparently valid. Asset auditing happens only when migration/export explicitly performs it.

   Smallest fix: store authoritative bytes under `.canonical/objects/<sha256>.<ext>` before committing a snapshot, require snapshot asset references to name those objects, and verify existence plus digest at commit/export. Amend the plan’s “no storage format changes” non-goal.

2. **P0 — Compatibility projections are allowed to fail silently even though editor reads still depend on them**

   Path: `tools/level-editor/levelbuilder/api/session.py:2077`

   `project_canonical_bird_compatibility()` describes the projection as best-effort and catches broad errors at `session.py:2149`, returning without a durable failure. The generated sidecars contain placement, cleanup, anchors, flips, and review flags, but no `sourceContentRevision`.

   Consequently, these derived formats can silently drift:

   - `session.json` → canonical snapshot or vice versa
   - `hitboxes.json` → canonical hitboxes
   - `dogs/dog_NN/sprite_000.png` → canonical sprite asset
   - `sprite_000.json` → canonical placement, cleanup, flips, anchors, and review state
   - `sprite_mask_000.png` → sprite pixels/generation
   - legacy review files → canonical review assertions

   Freshness cannot be determined from those files themselves.

   Smallest fix: switch canonical editor readers first. Until the projections are deleted, stamp every projection with `sourceContentRevision`, `birdId`, and relevant asset digest; reject or synchronously repair mismatches. Never swallow projection failure.

3. **P0 — Catalog snapshots claim immutable revisions while referencing mutable package paths**

   Paths:

   - `tools/level-editor/levelbuilder/api/public_levels.py:311`
   - `tools/level-editor/levelbuilder/api/public_levels.py:323`
   - `tools/level-editor/levelbuilder/api/session.py:5544`
   - `games/find_the_bird/public/levels/catalog-manifest.json`
   - `games/find_the_bird/public/levels/catalog-snapshots/catalog-001456.json`

   A direct audit found **163 of 2,268** catalog asset descriptors whose stored hash or size disagrees with the bytes at the referenced path. The same mismatches exist in `catalog-001456`, because both files point to mutable `levels/<id>/...` paths.

   Snapshot JSON is append-only; its referenced package is not. `packageId` hashes descriptors, not retained package bytes, and is truncated to 16 hex characters.

   Smallest fix: ManifestV2 must point to `.package-revisions/<level>/<content-revision>/...` or global CAS paths. Validate every required asset before activation. Use the full digest of a canonical package manifest as package identity.

4. **P0 — Canonical approval deletes WebP derivatives**

   Path: `tools/level-editor/levelbuilder/api/canonical_export.py:158`

   Canonical export stages only:

   - `color.png`
   - `bg_00.png`
   - sprite PNGs
   - `level.json`
   - `artifact-manifest.json`

   It then replaces the entire public package at `canonical_export.py:179`. Existing `color.webp` and `bg_00.webp` disappear. Legacy export regenerates WebPs, while manifest construction preferentially selects WebP at `public_levels.py:261` and `public_levels.py:283`.

   Smallest fix: generate WebPs deterministically inside canonical export staging before package validation and installation. Record both `sourceSha256` and derivative `{sha256, bytes}` in ManifestV2. Publish the PNG, WebP, level contract, and manifest atomically.

5. **P1 — The public identity schema contradicts canonical output**

   Paths:

   - `tools/level-editor/levelbuilder/api/canonical_export.py:72`
   - `tools/level-editor/levelbuilder/api/level_schema.py:74`
   - `games/find_the_bird/public/levels/nordic_cold_stockholm_christmas_market_bird_53ea/level.json`
   - `games/find_the_bird/public/levels/hawaii_volcano_national_park_bird_3900/level.json`

   Two incompatible shipped contracts coexist:

   - Legacy packages use `dogs[].id = dog_NN`.
   - Canonical packages use stable UUID `dogs[].id`, plus `compatibilitySlot` and `compatibilityAliases`.

   Yet `LevelFileV1` still requires `dog_NN` IDs and ignores extra fields. Therefore the declared schema rejects canonical output while permissive/untyped readers may silently discard the identity additions.

   Smallest fix: introduce an explicit `LevelJsonV2` with required `schemaVersion`, stable `birdId`, and immutable compatibility slot/path. Update Python and runtime consumers atomically; reject unsupported versions.

6. **P1 — Slot renumbering is data mutation, not presentation reordering**

   Paths:

   - `tools/level-editor/levelbuilder/api/canonical_bird_contract.py:213`
   - `tools/level-editor/levelbuilder/api/canonical_export.py:74`
   - `tools/level-editor/levelbuilder/api/corpus_migration.py:730`
   - `tools/level-editor/levelbuilder/api/session.py:5168`

   `birdId`, `compatibilitySlot`, and `presentationOrder` coexist in canonical snapshots. Elsewhere the slot is reconstructed from `session.json dogs[].index` or array enumeration.

   Renumbering slots breaks or changes:

   - `dogs/dog_NN/` directories
   - sprite, mask, and sidecar paths
   - legacy public `dogs[].id`
   - `compatibilityAliases`
   - artifact-manifest sprite paths
   - catalog asset paths and `dogSprite:<index>` roles
   - session `dogs[].index`
   - variant and review state keyed by index or slot
   - public-import UUID generation
   - package digests and cache identity

   Smallest fix: declare `compatibilitySlot` an immutable storage alias. Reorder only through `presentationOrder`. Add a projection-boundary invariant proving a bijection among `birdId`, slot, session index, sprite path, aliases, and manifest entry.

7. **P1 — Public import derives supposedly stable identity from positional slots**

   Path: `tools/level-editor/levelbuilder/api/corpus_migration.py:975`

   Public-only import parses the slot from the sprite path and derives UUID identity using level, slot, and variant. Renumbering the slot therefore produces a different stable ID for the same logical bird.

   Smallest fix: prefer embedded `birdId` or `compatibilityAliases`. For truly legacy packages, mint identity once and record `identityOrigin`; do not remint on subsequent imports. Do not base identity solely on a mutable position.

8. **P1 — The canonical revision filename does not prove the revision file is intact**

   Paths:

   - `tools/level-editor/levelbuilder/api/canonical_bird_contract.py:351`
   - `tools/level-editor/levelbuilder/api/canonical_bird_contract.py:297`

   Commit names a revision file from the SHA-256 of the complete serialized snapshot. Read validation recomputes only `contentRevision` and `operationalRevision`; it never checks that the complete file bytes match `revision-<sha>.json`.

   Fields excluded from both projections, including future or unknown fields, can change without invalidating either pointer digest.

   Smallest fix: on every current/history read, canonicalize the full snapshot and require its digest to equal the revision filename. Reject unknown fields so ignored data cannot sit outside the revision contract.

9. **P1 — Version fields exist but frequently are decorative**

   Current behavior:

   | Format | Version field | Reader behavior |
   |---|---:|---|
   | Canonical snapshot | `schemaVersion: 1` | Exact version checked; unknown keys accepted |
   | `.canonical/current.json` | `schemaVersion: 1` | Written but not checked |
   | `quarantine.json` | `schemaVersion: 1` | Not checked; malformed files collapse to generic quarantine |
   | Sprite sidecar | `version: 1` | Not checked |
   | `session.json` | None | Heuristics/defaults |
   | `hitboxes.json` | None | Heuristics/defaults |
   | `level.json` | None | V1 model or permissive parsing |
   | `artifact-manifest.json` | `schemaVersion: 1` | Narrow gate only |
   | `bundled-manifest.json` | `version: 1` | Inconsistently checked |
   | `catalog-manifest.json` | `version: 1` | Python and TS readers do not enforce it |
   | Catalog snapshots | `version: 1` | Same weakness as live catalog |
   | `levels-index.json` | None | Invalid data becomes `[]` |

   Paths:

   - `tools/level-editor/levelbuilder/api/canonical_bird_contract.py:196`
   - `tools/level-editor/levelbuilder/api/canonical_bird_contract.py:288`
   - `tools/level-editor/levelbuilder/api/public_levels.py:31`
   - `tools/level-editor/levelbuilder/api/public_levels.py:121`
   - `games/find_the_bird/src/v1core/assets.ts:160`

   Smallest fix: strict discriminated loaders for every retained format. Require a major schema version, reject unsupported versions and malformed required entries, and distinguish missing from present-but-invalid. Do this before deleting compatibility projections.

10. **P1 — The canonical snapshot is not a minimal authored-content schema**

   Path: `tools/level-editor/levelbuilder/api/canonical_bird_contract.py:104`

   The snapshot combines four classes of information:

   - Authored truth: scene choice, bird geometry, sprite choice/placement, cleanup geometry.
   - Derived facts: asset byte lengths, repeated source digests.
   - Compatibility data: `compatibilitySlot`.
   - Operational/audit data: presentation order, candidate reviews, migration state, job-related generation identifiers, review history.

   Redundant examples:

   - `activeGeneration.inputSceneSha256` duplicates the scene digest.
   - `cleanup.sourceSpriteSha256` duplicates the sprite asset digest.
   - `review.contentRevision` remains stored even where `scopeRevision` is authoritative.
   - `presentationOrder` is physically inside each bird but excluded from content hashing.
   - Migration history and invalidated review history inflate every immutable revision.
   - `bytes` is derivable from the CAS object.

   Smallest fix: split:

   - content revision: CAS references plus birdId-keyed authored state and current human assertions;
   - operational revision/log: order, jobs, migration, archive, candidate state, invalidated-review history;
   - compatibility projection: birdId-to-slot allocation.

   Do not delete provenance; move it out of content truth.

11. **P1 — Redundant writable fields have no single disagreement policy**

   Ranked by disagreement risk:

   1. Sprite pixels and placement/cleanup/flips across canonical snapshot, slot PNG/mask, sidecar, and public `level.json`.
   2. Hitboxes across canonical birds, `hitboxes.json`, public `level.json`, and some review records.
   3. Identity across canonical `birdId`/slot, `session.json` id/index, `hitboxes.json` id, directory name, aliases, and manifest roles.
   4. Review state across canonical reviews/history, legacy review files, and sidecar `humanReview`.
   5. Scene/restore identity across canonical descriptors, mutable authoring files, public PNGs/WebPs, and artifact manifests.
   6. Package metadata across `artifact-manifest`, bundled manifest, catalog manifest, and catalog snapshots.
   7. Archive state across `session.json` and the archive ledger.
   8. Generation status and prompt metadata.

   Smallest fix: add a format-authority registry to the plan. Each field class must name exactly one authored owner; every other occurrence is a generated projection with `sourceRevision` or is deleted.

12. **P1 — Archive has two authorities and unreadable state looks empty**

   Path: `tools/level-editor/levelbuilder/api/session.py:2574`

   Archive state exists in `session.json` and `.levelbuilder/state/archive-ledger.json`. Gallery semantics OR the session flag and ledger flag and union variant sets. The ledger loader converts missing, malformed, and I/O failure into `{}`, making corruption indistinguishable from an empty ledger.

   Smallest fix: make the versioned archive ledger the sole operational authority and fail loudly when present-but-invalid. Remove archive fields from canonical content; retain session fields only as stamped compatibility projections during migration.

13. **P1 — `artifact-manifest.json` does not cover the complete package**

   Path: `tools/level-editor/levelbuilder/api/canonical_export.py:103`

   It contains the canonical content revision and hashes for PNG scene, restore, and sprites, but omits:

   - `level.json` digest
   - serialized geometry digest
   - WebP files
   - derivative-to-master provenance
   - complete package digest

   Geometry can therefore drift while the artifact manifest still appears valid.

   The corpus is also mixed: **101** published `level.json` files versus only **44** artifact manifests.

   Smallest fix: absorb it into Package ManifestV2 listing every shipped file with `{role, path, sha256, bytes, sourceSha256?}` and the authoring content revision. Backfill or quarantine the 57 packages lacking it before making V2 mandatory.

14. **P1 — Three indexes redundantly represent the published set**

   Paths:

   - `tools/level-editor/levelbuilder/api/session.py:5511`
   - `tools/level-editor/levelbuilder/api/session.py:5998`
   - `games/find_the_bird/public/levels/levels-index.json`
   - `games/find_the_bird/public/levels/bundled-manifest.json`
   - `games/find_the_bird/public/levels/catalog-manifest.json`

   `levels-index.json`, bundled manifest, and catalog manifest repeat level identity/order and portions of package metadata. The code itself calls `levels-index.json` legacy, but reorder and publishing paths continue updating it. Reorder also silently skips requested IDs absent from the bundled manifest.

   Smallest fix: make Catalog ManifestV2 the sole committed selection/package authority. Generate the offline bundled starter set during the app build from a named immutable catalog/sequence revision. Delete `levels-index.json` only after locating old publisher and editor-order consumers.

15. **P2 — Stored `package.complete` and short `packageId` masquerade as authoritative facts**

   Path: `tools/level-editor/levelbuilder/api/public_levels.py:360`

   `complete` means only “positive bytes and at least two assets”; it does not prove the expected backgrounds, sprites, package schema, or provenance are complete. `packageId` uses only the first 16 hexadecimal characters of a descriptor digest.

   Smallest fix: derive completeness from strict ManifestV2 validation rather than store it. Use the full package-manifest SHA-256 as package identity. Preserve old IDs as temporary aliases for active and rollback sequence references.

16. **P2 — `commit.lock` and `staging/` are implementation details, not formats**

   Path: `tools/level-editor/levelbuilder/api/canonical_bird_contract.py:333`

   `commit.lock` is an empty lock inode. `staging/` holds atomic-write temporaries; the inspected corpus had no staged files. Neither should appear in the target data inventory as authority.

   Smallest fix: keep both as private storage mechanics. Garbage-collect abandoned staging entries and report orphan diagnostics separately. Do not version or migrate them as domain formats.

## Required plan amendments tonight

1. Remove the non-goal “No storage format changes; canonical revision store stays as-is.”
2. Make strict versioned loaders and schemas the first refactor unit.
3. Introduce canonical asset CAS before canonical-first reads.
4. Freeze compatibility slots; do not renumber them during the refactor.
5. Split content truth from operational/audit state.
6. Make canonical compatibility projection either synchronous and checked or unused by reads.
7. Replace mutable-path catalog snapshots with content-addressed package references.
8. Generate WebPs inside the atomic canonical export.
9. Define Package ManifestV2 before deleting `artifact-manifest.json`.
10. Migrate active/rollback references before changing package IDs or deleting retained packages.
11. Delete `levels-index.json` and hand-maintained bundled manifest only after consumer inventory and build-generation cutover.
12. Add corpus gates for the 57 packages without artifact manifests and current 163 catalog descriptor mismatches.

## Target format inventory

| Target format | Authority | Required identity/version/freshness | Replaces or deletes | Migration risk |
|---|---|---|---|---|
| `.canonical/current.json` | Pointer only | Strict `schemaVersion`; content and operational revision; revision-file full digest | Existing permissive pointer | Low; reject unsupported pointers loudly |
| `.canonical/revisions/revision-<sha>.json` content record | Sole authored gameplay truth | Strict schema; full-file digest; stable `birdId`; CAS refs; authored geometry; current human assertions | Canonical snapshot’s mixed content/operational shape | High; preserve approvals based on governed-content hashes |
| `.canonical/objects/<sha256>.<ext>` | Immutable asset bytes | Filename digest equals bytes; optional media metadata | Mutable authoring paths as canonical authority | High storage migration; deduplicate and verify before pointer cutover |
| Canonical operational record/event log | Sole mutable workflow truth | Strict schema and operational revision; jobs, ordering, archive, migration/audit history | `session.json` workflow fields, archive duplication, snapshot operational blob | High; preserve job/archive/review history |
| Compatibility projection map | Derived, temporary | `{birdId -> immutable compatibilitySlot}`, source content revision | `dogs[].index` as identity | Medium; slots must remain frozen |
| `level.json` V2 | Derived shipped runtime contract | `schemaVersion`, `sourceContentRevision`, stable bird identity, explicit compatibility alias/path | Unversioned legacy/canonical variants | High; runtime and exporter cut over together |
| Package ManifestV2 | Derived package authority | Full manifest digest; every file’s role/path/hash/bytes; stable-bird sprite roles; derivative source hashes | `artifact-manifest.json` and catalog’s duplicated asset lists | High; backfill or quarantine incomplete packages |
| Catalog ManifestV2 | Sole committed published selection authority | Strict version; immutable package digest/ref; lifecycle/retention/sequence references | Current catalog manifest, mutable-path package entries | High; active clients and rollback packages |
| Catalog snapshots V2 | Immutable selection snapshots | Content-addressed package references only; complete validation before activation | Existing snapshots over mutable paths | High; preserve referenced package bytes first |
| PNG scene/background/sprites | Shipped package bytes | Listed and digested in Package ManifestV2 | Loose untracked package files | Medium |
| WebP derivatives | Deterministic derived bytes | Own digest/bytes plus `sourceSha256` and encoder recipe/version | Opportunistic stale/missing WebPs | Medium; hashes/package IDs change |
| Generated bundled starter manifest | Build artifact, not authored state | Source catalog/sequence revision and build digest | Hand-maintained `bundled-manifest.json` | Medium; offline startup contract |
| Delete: `levels-index.json` | None | N/A | Legacy order/index duplicate | Medium; old editor/publisher consumers |
| Delete: sprite sidecar geometry/review data | None after reader cutover | N/A | Canonical placement/cleanup/flip/review duplication | High until every editor reader is canonical |
| Delete: authoring `hitboxes.json` | None after migration | N/A | Canonical hitbox duplication | High; legacy migration/review restoration depends on it |
| Delete/demote: `session.json dogs[]` | Recipe/legacy metadata only, if retained | Any retained file needs strict schema; no identity authority | Canonical identity, status, variant duplication | High; legacy generation endpoints |
| Delete: separate `artifact-manifest.json` | None after Package ManifestV2 | N/A | Partial package-provenance duplicate | Medium; export gates must move first |
| Private: `commit.lock`, `staging/` | No domain authority | Operational diagnostics only | Nothing | Low |

