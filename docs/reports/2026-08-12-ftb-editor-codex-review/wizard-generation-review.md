# FTB Level Editor WIZARD / GENERATION Correctness Review

Scope was read directly from the current checkout. No files were modified. Existing unrelated worktree changes were excluded.

## P1 — High severity

### 1. Canonical hitbox saves succeed but hydration returns stale geometry

The canonical `/hitboxes` path commits only the immutable canonical snapshot. It does not update the compatibility `hitboxes.json` projection. Hydration then unconditionally prefers `hitboxes.json`, so reloading the session can replace the just-saved geometry with stale coordinates.

This produces split-brain state: canonical export and review checks use the new geometry, while the wizard canvas shows the old geometry.

Refs: [session.py:1651](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:1651), [session.py:3051](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:3051), [routes.py:2250](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:2250)

### 2. Auto-placement, recentering, and magenta finalization bypass canonical CAS

Several geometry-producing routes call legacy `save_hitboxes()` directly:

- Random and smart auto-placement.
- Sprite-based and local-diff recentering.
- VLM placement.
- Magenta reconciliation/finalization.
- One-shot finalization.
- Magenta SSE startup.

On a `VALID_CURRENT` session, these operations mutate `hitboxes.json` without an expected content revision, without updating the canonical snapshot, and without invalidating canonical human reviews. The legacy review file may be revoked, but canonical review status continues to trust `reviews.hitboxes`.

The wizard can therefore display changed geometry while canonical export retains the old geometry and still considers it reviewed.

Refs: [routes.py:2440](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:2440), [routes.py:2541](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:2541), [routes.py:2740](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:2740), [routes.py:2995](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:2995), [session.py:3746](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:3746), [session.py:3865](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:3865), [session.py:4414](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:4414), [inpaint.py:5805](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:5805), [inpaint.py:6021](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:6021), [inpaint.py:6273](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:6273)

### 3. Background selection changes wizard authority without changing canonical authority

`/select-bg` writes only `session.json` fields such as `selected_bg`, dimensions, and sections. It does not update canonical scene/restore assets, require an expected revision, or invalidate reviews.

The UI also clears dogs and hitboxes only in its local query cache. Reloading restores the old persisted dogs/hitboxes onto the newly selected background. Subsequent generation can use the new legacy background while canonical export and reviews remain bound to the old scene.

Refs: [routes.py:1713](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:1713), [session.py:3322](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:3322), [StepBackgrounds.tsx:98](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/StepBackgrounds.tsx:98)

### 4. Inpaint can start against stale placement geometry

`DogsCanvas` persists edits on a trailing debounce. The Inpaint action immediately fetches server state without flushing or awaiting that pending save.

Dragging or adding a target and immediately clicking Inpaint starts paid work with the previous server-side hitboxes, despite the canvas showing the new placement.

Refs: [DogsCanvas.tsx:100](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/DogsCanvas.tsx:100), [StepPlaceDogs.tsx:191](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/StepPlaceDogs.tsx:191)

### 5. Rapid geometry edits self-conflict under canonical CAS

A second debounced save can be dispatched before the first response updates the cached `contentRevision`. Both requests then carry the same expected revision, so one loses CAS.

`inflightSaveRef` is overwritten rather than forming a serialized queue. The failed request does not restore server truth, leaving its optimistic geometry visible. `StepInpaint` has the same problem more directly: each mutation starts an independent immediate save with no serialization or rejection recovery.

Refs: [DogsCanvas.tsx:59](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/DogsCanvas.tsx:59), [DogsCanvas.tsx:73](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/DogsCanvas.tsx:73), [StepInpaint.tsx:340](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/StepInpaint.tsx:340)

### 6. Auto-placement can be overwritten by a pending manual save

Random and smart auto-placement do not flush or cancel the `DogsCanvas` debounce. A pending full-array manual save can land after auto-placement and overwrite the generated layout.

For smart placement, the UI can continue showing model explanations associated with geometry that is no longer stored.

Refs: [DogsCanvas.tsx:100](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/DogsCanvas.tsx:100), [StepPlaceDogs.tsx:226](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/StepPlaceDogs.tsx:226), [StepPlaceDogs.tsx:244](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/StepPlaceDogs.tsx:244)

### 7. Retrying an uncertain band job can double-charge

Worker recovery deliberately marks a provider-started job `orphaned_unknown` when it cannot know whether the provider charged or completed. Band job startup nevertheless requeues every terminal status, including `orphaned_unknown`.

Reposting the same request can therefore submit another paid generation without reconciling the uncertain first attempt.

Refs: [inpaint.py:3521](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:3521), [inpaint.py:3609](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:3609), [job_worker.py:230](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_worker.py:230), [job_store.py:620](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_store.py:620)

### 8. Partial band retries regenerate already-successful sides

Each band is persisted immediately. If top succeeds and bottom fails, the parent becomes terminal. Retrying requeues the entire job, clears its result, and loops over both requested sides again.

The successful top band is purchased and overwritten a second time instead of resuming only the missing side.

Refs: [inpaint.py:3521](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:3521), [inpaint.py:3615](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:3615), [job_store.py:620](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_store.py:620)

### 9. Band outputs have no scene provenance or publication CAS

The band idempotency key explicitly excludes the scene image. The worker reads whichever `color.png` exists when execution begins and writes shared `extension/top.png` and `bottom.png` paths. Acceptance checks only that both files exist.

If inpaint, variant selection, or another band job changes scene state concurrently, the accepted pair can contain stale or mixed outputs from different scene revisions. No hash binds either band to the reviewed scene.

Refs: [inpaint.py:3489](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:3489), [inpaint.py:3577](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:3577), [inpaint.py:3615](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:3615), [inpaint.py:3631](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:3631)

### 10. Same-session background jobs can overwrite each other

Generation deduplication applies only to an exact input hash. Changing configuration creates another runnable job for the same session. Both jobs write the same `bg_NN.png` paths and background records without per-session exclusivity or a finalization CAS.

An older job may consequently publish after a newer request, or a newer job may replace pixels already exposed and selected through the older job’s SSE stream.

Refs: [inpaint.py:2229](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:2229), [inpaint.py:2267](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:2267), [inpaint.py:2465](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:2465), [inpaint.py:2551](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:2551)

### 11. Accepted job starts can lose their resume pointer

Crop-inpaint and band hooks store the returned job ID only if their generation token is still current. If the POST is accepted but the user resets or changes sessions before the response returns, the job continues on the server but its ID is discarded.

Reopening cannot resume it, and the UI permits another paid submission.

Refs: [useInpaintStream.ts:228](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/useInpaintStream.ts:228), [useInpaintStream.ts:514](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/useInpaintStream.ts:514), [useBandGenStream.ts:97](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/useBandGenStream.ts:97)

### 12. Cloning copies canonical identity and reviews from the source session

Full clone copies `.canonical` byte-for-byte, then rewrites only legacy `session.json` and `level.json`. The cloned canonical snapshot retains the original `sessionId`, asset references, and reviews.

Canonical store reads do not reject this directory/name mismatch, and canonical hitbox saving does not re-check snapshot ownership. A clone can therefore inherit source approval and provenance or continue referencing source-owned assets.

Refs: [session.py:2168](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2168), [session.py:2188](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2188), [canonical_bird_contract.py:275](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/canonical_bird_contract.py:275), [session.py:1628](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:1628)

## P2 — Moderate severity

### 13. Partial background retry re-bills successful options

A retryable parent is requeued even when some background children succeeded. Requeue clears the parent result, preparation requeues every child—including successful ones—and the handler regenerates every index.

A 3-of-4 run followed by Retry purchases all four options again. There is also a narrow UI race: the initial POST and subsequent `/generate` request both invoke the start helper; if the first job becomes retryable between them, opening SSE can trigger the requeue.

Refs: [inpaint.py:2258](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:2258), [inpaint.py:2317](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:2317), [inpaint.py:2427](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:2427), [useBgStream.ts:237](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/useBgStream.ts:237)

### 14. SSE disconnect reconciliation treats hydration as generation success

For reference/magenta SSE lanes, any successful `getSession()` after disconnect sets `inpaintFailed: false` and stops the progress state. It never establishes that generation completed or that the dogs reached terminal states.

A provider call may still be running—or may later fail—while the wizard reports the inpaint lane as successful.

Ref: [useInpaintStream.ts:291](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/useInpaintStream.ts:291)

### 15. Wizard advertises review readiness for failed or mutating content

`showStep5` treats errored dogs as complete and treats a regenerating dog with an older variant as settled. It then unlocks band generation and displays “This level is ready for Gallery review.”

This permits review to begin after failed initial generation or while paid regeneration can still change the governed content.

Refs: [App.tsx:390](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/App.tsx:390), [App.tsx:620](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/App.tsx:620)

### 16. Background resume hides `orphaned_unknown` and cancelled outcomes

Resume considers these states terminal but sets `generationFailed` only when the status begins with `failed`. An uncertain paid outcome therefore stops the generating indicator without exposing primary failure state.

The live SSE recovery path correctly treats every terminal non-success as failed, so resume and live behavior diverge.

Refs: [useBgStream.ts:476](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/useBgStream.ts:476), [useBgStream.ts:405](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/useBgStream.ts:405)

### 17. Background SSE announces completion before durable terminal state

The handler emits `generate_complete` before transitioning a failed job or returning control to the worker for the success transition. The UI immediately closes SSE and labels the operation terminal.

A crash or persistence failure in that gap leaves the job running or orphaned while the wizard already reports completion.

Refs: [inpaint.py:2596](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:2596), [job_worker.py:273](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_worker.py:273), [useBgStream.ts:334](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/useBgStream.ts:334)

### 18. Byte-identical canonical saves revoke valid reviews

`save_canonical_hitboxes_if_present()` always invalidates hitbox and downstream reviews before assigning incoming geometry. It does not compare the incoming geometry with the current snapshot first.

A debounce retry or equivalent save therefore revokes human approval even when governed content is unchanged.

Refs: [session.py:1651](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:1651), [canonical_bird_contract.py:177](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/canonical_bird_contract.py:177)

### 19. Session creation can overwrite an existing session directory

Readable IDs use a four-hex-character suffix. Creation then calls `mkdir(..., exist_ok=True)` and overwrites `session.json` without verifying that the directory is new.

A collision or concurrent duplicate ID can reset configuration while retaining prior backgrounds, hitboxes, dogs, or canonical data. Hydration then combines a fresh session record with stale artifacts.

Refs: [routes.py:989](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:989), [session.py:3168](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:3168), [session.py:3212](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:3212)

## Priority order

The first repair boundary should be findings 1–3: establish one authoritative CAS-aware mutation service that updates canonical state and compatibility projections together, including review invalidation. Then serialize wizard geometry saves and add paid-job provenance/resume guarantees before addressing the remaining UI state divergences.

