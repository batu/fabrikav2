# FTB Level Editor Correctness Review

Scope: GALLERY, LINEUP, EXPORT, and CATALOG backend/UI paths. Read-only review; no files changed and no tests run. Three independent reviewers examined gallery/review state, sequence/archive behavior, and export/catalog integrity.

Verdict: **Not ready for reliable publishing.** No P0 was found, but several P1 paths can approve unseen content, activate stale catalog bytes, or mutate bundle state during a failed Start.

## P1 — High severity

### 1. Final-cutout CAS conflict approves a revision the human never reviewed

[GalleryReviewModal.tsx:945](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:945)

The modal submits the locally displayed content revision. If the server returns `content_revision_conflict`, lines 952-956 extract the server’s current revision and immediately retry approval without reloading the scene, cutouts, or placements.

Another tab or CLI can change the level between inspection and approval; the retry then blesses that unseen revision.

Fix: never retry a human approval across a CAS conflict. Reload the current revision and assets, clear the displayed approval state, and require another explicit review click.

### 2. Gallery can publish and Lineup can activate an obsolete catalog package

[session.py:2522](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2522), [GalleryPage.tsx:861](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryPage.tsx:861), [sequence_workflow.py:599](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/sequence_workflow.py:599)

`catalogUploaded` means only that an entry with this level ID exists. Gallery hides the Publish button whenever that is true. Sequence validation independently verifies:

- Current authoring revision has current reviews.
- A listable catalog entry exists.

It never requires the catalog entry’s `contentRevision` or package identity to match the current canonical authoring revision.

Scenario: publish revision A, edit and review revision B, then Start. Gallery offers no republish, validation accepts B’s reviews plus A’s catalog entry, and players receive A.

Fix: expose current authoring and catalog revisions, show “Republish” when they differ, and block dry-run/activation unless the catalog’s immutable package identity matches the reviewed authoring revision.

### 3. Start mutates bundle files before activation succeeds

[routes.py:3258](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:3258), [routes.py:3423](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:3423)

Start performs:

1. Dry-run.
2. Bundle projection writes.
3. Remote activation.

Bundle projection upserts entries and destructively reorders `bundled-manifest.json` and `levels-index.json` before remote activation. If activation later fails because of stale state, missing authentication, Remote Config conflict, or network failure, Start reports failure while the shipped bundle projection remains changed.

Fix: construct the complete bundle/index candidate without writing, publish or reserve activation, then atomically commit the projection during successful finalization. Otherwise restore the exact previous files and report compensation failures explicitly.

### 4. Bundle projection can package a different draft from the one Start validated

[routes.py:3264](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:3264), [routes.py:3386](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:3386)

The dry-run validates request tokens, but `_bundle_projection()` subsequently rereads the current draft without accepting a draft revision or expected level list.

A save or archive between these operations can make packaging consume draft B while activation still attempts CAS against draft A. Activation rejects A, but B’s bundle projection has already landed.

Fix: pass the validated draft revision, live version, catalog revision, and exact level IDs into bundle projection; verify them under the sequence lock immediately before a single atomic commit.

### 5. Archive can race activation and reintroduce an archived level

[sequence_workflow.py:809](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/sequence_workflow.py:809), [sequence_workflow.py:869](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/sequence_workflow.py:869)

`remove_level_from_draft()` intentionally bypasses client CAS but also ignores the live-sequence mutation guard.

If an operator archives level L while Start is publishing a candidate containing L:

- Archive persists and returns `removedFromLineup: true`.
- Activation completes from its earlier candidate.
- `set_live_sequence_from_activation()` overwrites both live and draft state, restoring L.

The remote sequence can now reference an archived or revoked level.

Fix: archive must participate in the live-mutation guard and return 409 while activation is in flight, or activation must revalidate archive/package/draft state immediately before publishing and finalizing.

### 6. Archiving an unused variant removes the entire level from Lineup

[routes.py:3582](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:3582), [GalleryPage.tsx:920](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryPage.tsx:920)

Preview revocation correctly checks whether the archived variant is the exported variant. Lineup removal does not: every per-variant archive calls `remove_level_from_draft(session_id)`.

Archiving an unused OpenAI comparison card can therefore drop the usable Gemini level from the sequence. The inline Gallery handler ignores `removedFromLineup`, so it continues displaying “in Lineup” until a later reload.

Fix: un-lineup only for whole-session archive or when the archived variant makes the session unavailable for Lineup. Return and consume the updated sequence state immediately.

### 7. Legacy sessions can publish without either human review

[GalleryPage.tsx:649](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryPage.tsx:649), [session.py:5031](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:5031), [session.py:5818](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:5818)

Canonical export requires a current final-cutout review. The migration-required legacy export path has schema, geometry, and visibility gates but no equivalent current hitbox/final-cutout review gate.

Gallery calculates `fullyReviewed`, but only uses it for the star; the Publish button remains enabled for every non-background, non-uploaded card.

Fix: make `approve_level_for_catalog()` enforce current hitbox and final-cutout review for both canonical and legacy representations. UI eligibility should mirror that server rule.

## P2 — Moderate severity

### 8. Hitbox review can conflict with the modal’s own preceding save

[GalleryReviewModal.tsx:345](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:345), [GalleryReviewModal.tsx:889](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:889)

`flushPendingSave()` commits a new revision and updates the session cache, but the approval handler then prefers the render-closure `state.contentRevision`. React may not have rerendered yet, so the request uses the pre-save revision and receives a false 409.

The final-cutout handler has the same stale preference, currently concealed by finding #1’s unsafe retry.

Fix: have `flushPendingSave()` return the committed revision, or read the cache first after it resolves.

### 9. Archive is a partial transaction whose error response can contradict disk

[routes.py:3581](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:3581)

The operation persists archive state first, then modifies preview manifests and the sequence draft. A later exception returns an HTTP failure although the archive bit is already durable. The card-level handler only logs the error and retains its old UI state.

Fix: coordinate these writes transactionally or return structured partial-success state and force a full authoritative refresh.

### 10. Bundle application is internally non-atomic

[routes.py:3429](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:3429)

Prevalidation covers level readiness, but application performs N independent manifest upserts followed by a separate destructive reorder. An I/O failure on a later write leaves earlier changes installed.

Fix: build and validate the final manifest and index in memory, then commit with rollback/journaling or reduce them to one authoritative atomic artifact.

### 11. Publish can commit catalog successfully and still return failure

[session.py:5848](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:5848), [routes.py:2683](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:2683)

The public package and catalog manifest are committed before bundled-manifest and session metadata refreshes. The route then performs another bundled upsert. Failures in these later operations return an error even though catalog publication already succeeded.

The UI generates a fresh timestamp request ID on retry, so it cannot reliably resume the partial operation.

Fix: use one stable idempotency key and transactional catalog/bundle projection, or return a durable partial-success result that retries can resume.

### 12. Catalog approval does not validate the complete manifest against disk

[session.py:5592](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:5592), [export_gate.py:155](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/export_gate.py:155)

Approval validates the newly staged level, then writes it together with all existing catalog entries. It does not run the existing whole-corpus/catalog asset verification before returning success.

A hand-edited entry, missing retained package, or prior disk divergence can therefore survive while a new publish reports success.

Fix: validate the prospective complete catalog against prospective disk before commit, then read back and verify after installation.

### 13. Catalog refresh can discard immutable canonical provenance

[session.py:5741](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:5741), [session.py:5837](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:5837)

Canonical approval records `contentRevision` and `retainedPackagePath`. `refresh_catalog_packages()` rebuilds entries from public disk and preserves selected metadata, but not those provenance fields.

A batch refresh can create a new catalog revision whose canonical entry no longer identifies its immutable retained revision.

Fix: preserve those fields when package bytes are unchanged; otherwise retain and stamp the newly refreshed immutable package explicitly.

### 14. Rollback can publish payload A but record local state B

[sequence_activation.py:811](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/sequence_activation.py:811)

Rollback verifies that `rawPayload` matches its stored hash, but uses independently stored `catalogRevision` and `levelIds` for validation and the local live mirror. Activation-ledger normalization does not validate internal agreement within version records.

A damaged ledger can therefore publish valid raw payload A, then report success and set the editor’s live mirror to metadata B.

Fix: parse and schema-validate `rawPayload`, then require exact equality with the record’s sequence version, catalog revision, and level IDs.

### 15. Dry-run can return a soon-stale success during live publication

[sequence_workflow.py:907](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/sequence_workflow.py:907)

Save and reset enforce `_assert_no_live_sequence_mutation`; dry-run does not. It can return success from the pre-activation state while another Start is publishing, and the UI installs that state and clears conflict.

Fix: reject dry-run while the live mutation guard is held, or attach and revalidate a mutation/version token before reporting success.

### 16. Package-only cards can display a false “Fully reviewed” star

[GalleryPage.tsx:97](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryPage.tsx:97), [GalleryPage.tsx:812](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryPage.tsx:812)

The review summary forces `assetBase === "public-levels"` into `reviewed`, regardless of backend review booleans. That drives the gold star even for a package with absent or stale review evidence.

Fix: model package-only as a separate non-reviewable state and derive the star only from current hitbox and final-cutout assertions.

### 17. A malformed artifact can take down the entire Gallery list

[session.py:2475](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2475), [session.py:1170](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:1170)

Per-session `level.json` parsing and reviewed sprite-sidecar parsing are not isolated. One corrupt JSON file can raise out of `list_sessions()`, making `/sessions` fail rather than quarantining one card.

Fix: contain errors per session, return an explicit integrity state, and continue listing the remaining corpus.

### 18. Corrupt archive ledger silently resurrects archived packages

[session.py:107](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:107), [session.py:135](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:135)

Missing, unreadable, and malformed archive ledgers all become `{}`. Gallery then treats every ledger-only package as unarchived, and the next archive write can overwrite the ledger starting from that empty state.

Fix: distinguish absent from corrupt/unreadable, retain a last-known-good copy, and refuse read-modify-write when existing state cannot be parsed.

### 19. Durable Start recovery is abandoned on transient read failure

[SequencePage.tsx:451](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/SequencePage.tsx:451)

On mount, any failure fetching the saved job ID removes it from local storage without surfacing recovery status. The backend job may still be running, while the UI looks idle and permits another Start after reload.

Fix: retain the job ID on network and 5xx errors, display recovery failure, and retry. Remove it only after a definitive 404/expiry or terminal result.

## P3 — Low severity

### 20. Save accepts duplicate level IDs and returns HTTP success

[sequence_workflow.py:772](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/sequence_workflow.py:772), [sequence_workflow.py:589](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/sequence_workflow.py:589)

Syntax validation permits duplicates. Save persists them and returns state normally; only the returned validation diagnostics mark the draft blocked.

Fix: reject duplicates during save with a 400 response, or make the save response explicitly unsuccessful.

## Recommended fix order

1. Remove the unsafe human-review CAS retry.
2. Pin Start to one exact draft and make bundle projection transactional.
3. Require catalog package revision equality with current reviewed authoring.
4. Serialize archive against activation and correct per-variant un-lineup semantics.
5. Enforce reviews in the catalog server chokepoint.
6. Harden catalog/archive partial transactions, provenance, and whole-catalog verification.
7. Fix UI cache/recovery and malformed-artifact isolation.

Existing dirty catalog manifest/snapshot changes were treated as user-owned and were neither modified nor used as proof of correctness.

