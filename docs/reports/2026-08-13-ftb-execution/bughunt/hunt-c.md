I’m using the debugging workflow plus the recurring-failure index because this is a state-machine bug hunt, not a change request. I’ll trace API contracts, persistence, and UI revision threading, then produce numbered executable repros with residual state, recovery, and severity.

The recurring-failure index has no direct match for these editor/CAS sequences, so I’m continuing with a fresh causal trace. The prior project notes do flag two likely pressure points to verify against current code: level-wide save serialization and live-modal revision authority.

One concrete wedge is now confirmed in the UI/API handoff: a successful `/geometry` response updates React state but not the modal’s cached revision. That state change itself schedules a redundant `/hitboxes` save using the pre-geometry revision, guaranteeing a 409; conflict reconciliation can then overwrite a newer local add/move snapshot with server truth. I’m checking the remaining review, job, lineup, and cross-surface sequences for the same “successful request leaves the next request stale” class.

The first targeted test command used repo-root paths from inside `tools/level-editor`, so pytest found no files; that is a command-path error, not a product result. I’m rerunning the same narrow suites with paths relative to the actual working directory.

1. **Geometry response → debounced `/hitboxes` save uses the previous revision — data-loss race. Severity: Critical.**

   Root cause: `/geometry` updates component state and hitboxes, but `updateCachedHitboxes()` does not update the cached revision. Changing `state.hitboxes` schedules another save, and `persistCachedHitboxes()` reads its revision from that stale cache. See [GalleryReviewModal.tsx](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:342), [GalleryReviewModal.tsx](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:348), and [GalleryReviewModal.tsx](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:881).

   Executable-style repro:

   ```text
   R0 = GET /api/sessions/$ID -> contentRevision

   POST /api/sessions/$ID/geometry
     {"operation":"clear","expectedContentRevision":R0,"humanActor":"human:test"}
   -> 200, revision R1, hitboxes []

   UI dispatches SET_HITBOXES([])
   -> count decreased, so queueHitboxSave([]) runs immediately

   POST /api/sessions/$ID/hitboxes
     {"hitboxes":[],"action":"edit","expectedContentRevision":R0}
   -> 409, actualContentRevision R1

   Before that 409 settles:
     click Add, drag the new hitbox
     -> local state contains the new bird and schedules another save
   ```

   State left behind:

   - Server: correctly cleared at `R1`.
   - Cache: eventually reconciled to `R1`.
   - Canvas: the 409 handler updates the revision but does **not** dispatch the returned `serverHitboxes`; therefore locally added geometry can remain visibly present even though it was never persisted.
   - The queued add/move may then be replaced by a later `SET_HITBOXES` response or fail against an unexpected snapshot.
   - The modal’s save chain records a rejected promise; navigation/blessing may report “retry the edit,” despite the geometry operation itself succeeding.

   The same deterministic stale save occurs after **grow/shrink**: `/geometry` returns `R2`, `SET_HITBOXES` schedules a redundant `/hitboxes` save, and that save uses `R1`.

   Recovery: reload/reopen the session and redo any add/move not present in server read-back. No backend surgery is required, but unsaved geometry is unrecoverable if the operator no longer remembers it.

2. **Hitbox re-bless falsely reports final-cutout readiness. Severity: High.**

   The canonical hitbox-review response hardcodes:

   ```json
   {"ready": true, "missingCutouts": 0}
   ```

   instead of calling the actual completeness calculation. The real readiness code requires at least one bird and a verified sprite for every bird; see [session.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:1210). The modal trusts the false response and enables final blessing.

   Executable-style repro:

   ```text
   PUT /api/sessions/$ID/hitbox-review
     {"approved":true,"expectedContentRevision":R0,"humanActor":"human:test"}
   -> hitboxes blessed

   POST /api/sessions/$ID/geometry
     {"operation":"add","hitboxes":[{"x":100,"y":100,"r":30}],
      "expectedContentRevision":R0,"humanActor":"human:test"}
   -> R1; new bird has no sprite; both reviews invalidated

   PUT /api/sessions/$ID/hitbox-review
     {"approved":true,"expectedContentRevision":R1,"humanActor":"human:test"}
   -> 200 and incorrectly says finalCutoutReadiness.ready=true

   PUT /api/sessions/$ID/final-cutout-review
     {"approved":true,"expectedContentRevision":R1,"humanActor":"human:test"}
   -> 409 final_cutouts_incomplete
   ```

   `clear → re-bless → final bless` is an even smaller repro: an empty canonical level may be hitbox-blessed, the response claims readiness, and the completeness gate refuses final blessing because `bool(birds)` is false.

   State left behind: current hitbox blessing, no final blessing, and an enabled final-review button that can only fail. Review scoping itself is sound: geometry invalidates both assertions, and final blessing checks the current hitbox `scopeRevision`.

   Recovery: in UI, run extraction for every missing bird, reload readiness, then bless final cutouts. An empty level must first receive a bird. No backend surgery.

3. **`completed_stale → rerun-stale → revert` is not a realizable state path. Severity: Medium for wedging; High for paid-work usability.**

   Executable-style repro:

   ```text
   # Start extraction for a sprite-less bird at R0, with current hitbox blessing.
   POST /api/sessions/$ID/retry-failed-dogs
     {...,"birdIds":["$BIRD"],"cutoutOnly":true,
      "expectedContentRevision":R0}

   # Move that bird after provider submission begins.
   POST /api/sessions/$ID/hitboxes
     {"hitboxes":[...moved $BIRD...],"expectedContentRevision":R0}
   -> R1; hitbox review invalidated

   # Provider returns; promotion revalidates captured bird input.
   -> child status=succeeded, stage=completed_stale,
      disposition=needs_review
   -> paid artifact parked, canonical sprite still missing

   POST /api/sessions/$ID/rerun-stale
     {"expectedContentRevision":R1,"humanActor":"human:test","dryRun":true}
   -> reports $BIRD

   POST /api/sessions/$ID/rerun-stale
     {"expectedContentRevision":R1,"humanActor":"human:test","dryRun":false}
   -> 409 hitboxes_not_blessed
   ```

   The UI does not explain this prerequisite in the rerun flow; the move necessarily invalidated the blessing required by `_start_retry_failed_dogs_job_record()`.

   After re-blessing, rerun can create and promote the first sprite. But `revert-sprite` then has no predecessor:

   ```text
   GET /api/sessions/$ID/birds/$BIRD/sprite-history
   -> one distinct sprite
   UI -> "No previous extraction to revert to."
   ```

   Conversely, if the bird already had a previous sprite, it has no `extract` obligation, so `/rerun-stale` will not queue it. Thus the requested `completed_stale → rerun-stale → revert` chain splits into two mutually exclusive branches.

   State left behind: parked paid artifact under `.canonical/job-artifacts`, job marked successfully completed-but-stale, canonical revision unchanged by the artifact, and hitbox review absent.

   Recovery: entirely in UI—re-bless hitboxes and rerun extraction. The parked result cannot currently be adopted; rerunning spends again. Revert becomes available only after two committed distinct sprites. No backend surgery, but there is no UI recovery that salvages the already-paid stale artifact.

   Double-spend check: a second concurrent paid job for the same bird is blocked by the existing one-active-paid-job guard, so I did **not** find an additional duplicate-provider-spend path here.

4. **Archive/catalog/draft transitions stale the Gallery’s lineup token; the session-wide archive API can partially commit then fail. Severity: High for the API variant; Medium in normal Gallery use.**

   Normal variant-card repro:

   ```text
   PATCH /api/sessions/$ID/archive
     {"archived":true,"variant":"gemini"}
   -> removes $ID from backend draft

   PATCH /api/sessions/$ID/archive
     {"archived":false,"variant":"gemini"}
   -> does not restore draft membership

   PUT /api/sequence/draft
     {...,"levelIds":[...,"$ID"], old current tokens...}
   -> draft contains $ID; catalogLevelMissing until catalog approval

   POST /api/sessions/$ID/approve-catalog?requestId=repro-123&bundled=true
   -> catalogRevision advances; existing draft baseCatalogRevision is now stale

   PATCH /api/sessions/$ID/archive
     {"archived":true,"variant":"gemini"}
   -> backend removes $ID and rebases the draft
   ```

   State left behind: backend is consistent, but Gallery’s `lineupState` is not refreshed by archive/unarchive callbacks. Its local draft still contains `$ID` with the old `draftRevision`/catalog revision. The next lineup toggle sends stale tokens and receives 409. See the CAS checks in [sequence_workflow.py](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/sequence_workflow.py:750).

   Recovery: refresh Gallery or close the review modal, which reloads sessions and sequence state. No backend surgery.

   More serious session-wide API repro:

   ```text
   # Draft contains $ID but its catalog base became stale after approve-catalog.
   PATCH /api/sessions/$ID/archive
     {"archived":true}
   ```

   `set_archived()` writes `session.json` first, then calls the revision-checked `_remove_from_sequence_draft()`. Draft removal throws, so the request fails after the archive bit has already persisted. The route’s newer revision-bypassing removal helper is never reached.

   State left behind: session archived, level still present in the draft, HTTP failure returned to the caller—an illegal partial commit.

   Recovery: use the sequence reset/save UI after reload, or issue a variant-scoped archive so the route-level removal helper runs. Direct file/database surgery is unnecessary, but ordinary retry of the same session-wide request remains wedged.

5. **Wizard and review modal alternate successfully once, then the wizard becomes a stale optimistic editor. Severity: High.**

   Executable-style repro:

   ```text
   Surface A = Wizard/DogsCanvas, loaded at R0
   Surface B = GalleryReviewModal, loaded at R0

   A: move bird X
   POST /api/sessions/$ID/hitboxes expected R0
   -> 200 R1

   B: move bird Y
   POST /api/sessions/$ID/hitboxes expected R0
   -> 409 actual R1; modal adopts the revision/server truth

   B: redo move bird Y
   POST /api/sessions/$ID/hitboxes expected R1
   -> 200 R2

   A: move bird X again
   POST /api/sessions/$ID/hitboxes expected R1
   -> 409 actual R2
   ```

   DogsCanvas gets its revision exclusively from the React Query cache and only advances it after successful saves; it has no conflict reconciliation or refetch path in `persistHitboxes()`. See [DogsCanvas.tsx](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/DogsCanvas.tsx:59).

   State left behind:

   - Server safely retains B’s `R2`; CAS prevents silent overwriting.
   - Wizard continues displaying its optimistic unsaved move.
   - Wizard cache remains at `R1`, so every subsequent save repeats the 409.
   - This is a persistent UI wedge, not server data corruption.
   - Modal recovery is better but still discards the conflicting local edit rather than merging independent hitbox changes.

   Recovery: reload/refetch the Wizard session, then repeat the edit. No backend surgery.

   A related same-bird sprite-placement hazard remains: CutoutReviewPanel responds to a 409 by adopting the current revision and automatically retrying the exact stale placement. That converts a detected same-bird conflict into last-writer-wins without requiring the operator to inspect the other surface’s change; see [CutoutReviewPanel.tsx](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:507). It can lose the other surface’s placement, although CAS prevents malformed state.

6. **Verification and coverage conclusion.**

   Current targeted single-request suites pass: **36 passed** across read-back status, canonical job provenance, lifecycle, and cutout regeneration/review tests. They prove individual endpoint contracts, but none executes the complete UI/API chains above. No files were changed.

   The most urgent regression tests are:

   1. Gallery modal: `/geometry R0→R1` followed by its induced `/hitboxes` save must use `R1`, and server read-back must not schedule another save.
   2. Review API: hitbox blessing response must return the same readiness as `GET final-cutout-review/readiness`.
   3. Job journey: move-during-provider → `completed_stale` → re-bless → rerun; explicitly assert the parked-artifact/revert semantics.
   4. Lifecycle API: catalog revision advancement followed by session-wide archive must be atomic.
   5. Two independent clients: alternating saves must reconcile/refetch or visibly reject local optimistic state, never remain indefinitely stale.

