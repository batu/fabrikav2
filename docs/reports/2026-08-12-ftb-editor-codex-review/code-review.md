# FTB Level Editor Correctness Review

Scope: supplied one-day diff, commit log, and final working tree. Read-only review; unrelated working-tree changes were excluded.

Review agents: CAS/restore, nonce/queue, and projection/migration/archive.

## P1 - High

### 1. Canonical revision is published before its scene bytes exist

[session.py:2046](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2046) commits `current.json` and releases the canonical lock before [session.py:2052](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2052) replaces `color.png`.

A reader in that interval sees a snapshot whose scene descriptor disagrees with disk. If `os.replace` fails or the process crashes, the canonical state remains permanently invalid, and retries reject it as non-promotable.

Fix: stage both scene and revision, then publish them under one locked recovery protocol. At minimum, replace the scene before publishing the pointer and restore the previous scene on CAS failure.

### 2. Regeneration falsifies artifact provenance

The promoted bird initially records the genuine input scene at [session.py:1987](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:1987), but [session.py:2042](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2042) overwrites every bird’s `inputSceneSha256` with the newly composed output scene digest. [session.py:2044](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2044) similarly relabels unchanged restore bytes.

Untouched sprites are consequently claimed to have been generated from a scene that did not yet exist, while the regenerated sprite becomes circularly attributed to its own output. Contract validation only checks equality, so this false lineage passes.

Fix: distinguish actual generation input provenance from current-scene compatibility. Do not rewrite historical input digests merely to satisfy a current-scene equality invariant.

### 3. Cleanup masks can make any broken scene pass the restore gate

[_scene_matches_clean at corpus_migration.py:529](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/corpus_migration.py:529) replaces all pixels inside cleanup boxes before calculating MAE. Cleanup geometry has neither bounds nor maximum-coverage enforcement at [canonical_bird_contract.py:243](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/canonical_bird_contract.py:243).

A malformed cleanup box covering the frame makes the masked MAE exactly zero for completely unrelated scene and clean images. The code can then promote the clean background as restore at [corpus_migration.py:637](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/corpus_migration.py:637) or [corpus_migration.py:823](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/corpus_migration.py:823), laundering the level into valid canonical state.

Fix: reject out-of-bounds or excessive aggregate mask coverage and require a meaningful minimum number of unmasked pixels before accepting MAE.

### 4. Quarantine is removed before the replacement commit succeeds

[corpus_migration.py:901](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/corpus_migration.py:901) deletes the authoritative quarantine marker before the CAS commit at line 902.

A conflict, validation error, I/O failure, or crash between these operations leaves the old pointer exposed without its quarantine marker. A previously quarantined snapshot may immediately read as `VALID_CURRENT`.

Fix: preserve the marker until the new pointer has committed, or make marker removal part of the locked publish/recovery transaction.

### 5. Older compatibility projections can overwrite newer commits

[project_canonical_bird_compatibility at session.py:2079](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2079) projects a caller-supplied snapshot after the canonical commit, without revision checking or serialization.

Interleaving:

1. Request A commits revision A and pauses before projection.
2. Request B commits and projects revision B.
3. Request A resumes and overwrites the sidecar or sprite with revision A.

Canonical remains at B while editor-facing legacy surfaces show A. Projection errors are silently swallowed at [session.py:2130](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2130), and no guaranteed reconciliation follows.

Fix: project under a revision-bound lock and verify that the supplied revision is still current immediately before replacement. Persist projection-needed state and retry failures.

### 6. Fresh nonces allow duplicate paid work for the same bird

The UI creates a new nonce for every invocation at [CutoutReviewPanel.tsx:601](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:601). The backend appends it to the idempotency key at [inpaint.py:4350](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:4350), so every retry becomes a distinct durable job.

“Stop” only aborts client polling; it does not cancel a submitted backend job. Retrying, reloading, or using another client can therefore submit the same paid provider operation twice. CAS may make one result stale, but billing has already occurred.

Fix: retain attempt identity across ambiguous retries and enforce one active paid job per `(session, bird, operation, captured input revision)`. A deliberate new attempt should require cancellation/finalization of the prior one.

### 7. CAS conflicts are retried using stale crop geometry

[CutoutReviewPanel.tsx:623](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:623) handles a revision conflict by substituting the server’s current revision and resending the previously computed crop without refreshing the bird.

The canonical backend accepts this supplied crop at [inpaint.py:4283](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:4283), but does not perform the containment validation used by the legacy path. If another client moved or recentered the bird, the retry can bill and promote extraction of the wrong scene region under the new revision.

Fix: do not automatically upgrade the revision. Refresh canonical state, recompute the crop, and require the user to retry; also validate canonical crop containment server-side.

### 8. Public-import fallback always fails after partially overwriting authoring state

When a public sprite is missing, [corpus_migration.py:966](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/corpus_migration.py:966) falls back to the corresponding session-side file. At [corpus_migration.py:995](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/corpus_migration.py:995), it then calls `copy2` with identical source and destination paths, raising `SameFileError`.

The public scene and background were already copied at [corpus_migration.py:986](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/corpus_migration.py:986), leaving a hybrid partially imported session.

Fix: skip self-copies and stage the complete import in a temporary tree before replacing authoring files.

### 9. Public import performs fallible validation after destructive writes

The preflight only verifies that cleanup is a dictionary at [corpus_migration.py:960](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/corpus_migration.py:960). After mutation begins, the implementation parses sidecars and directly indexes/converts geometry at [corpus_migration.py:991](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/corpus_migration.py:991).

Malformed JSON, missing cleanup keys, or nonnumeric geometry can abort after backgrounds and earlier birds have already been replaced.

Fix: fully parse and validate every source, sidecar, and output document before writing anything, then atomically publish a staged import.

## P2 - Moderate

### 10. Package-only per-variant archive operations discard prior ledger state

The package-only fallback at [session.py:6100](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:6100) writes exactly `[variant]` for each archive request.

Archiving B after A removes A from the ledger. Unarchiving either variant records an empty list and removes every other archived variant.

Fix: load and merge the existing ledger variants using the same add/discard semantics used for `session.json`.

### 11. Recenter can overwrite concurrent hitbox edits

The recenter path reads the full hitbox array outside the session lock at [session.py:3666](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:3666), then later saves that stale full-array snapshot.

A move or addition committed between those operations is overwritten or omitted. Tombstones only protect concurrent deletions.

Fix: bind recenter to an expected content revision and perform read/transform/write under the same lock or canonical CAS.

### 12. An all-stale queue run is persisted as successful despite changing nothing

Preflight-stale children are recorded as `succeeded/completed_stale` at [inpaint.py:4810](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:4810). When every unit is stale, the handler still returns normally around [inpaint.py:5005](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:5005), allowing the parent job to become `succeeded`.

Clients that rely on the durable parent status rather than inspecting every unit observe success even though no level artifact was persisted.

Fix: give the parent an explicit `completed_stale`/`needs_review` terminal status, or fail the job contract when `succeeded == 0`.

---

> **Verdict: Not ready**
>
> Fix the scene/pointer transaction, quarantine fail-open window, projection ordering, restore-mask laundering, and nonce/CAS retry behavior before relying on this migration or queue in normal editor use. The public import paths also need staging before they can safely repair damaged authoring state.

No fixes were applied and no test suite was run; findings were verified by tracing the supplied diff and final source.

