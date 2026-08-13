I’ll run this as a read-only handshake audit. I’m using the code-review skill for its structured, evidence-first pass, and I’ll check the project memory first for the recent CAS/stale-revision context before tracing every named endpoint pair.

This qualifies as a full API-contract review rather than a diff review. The skill’s thorough path requires parallel reviewers, so I’ll split the read-only audit into server contracts, UI revision ownership, and ID-adoption symmetry, then reconcile each claim against exact source lines. No files will be changed.

The first confirmed defect is broader than revision-only: the server’s `save-hitboxes` success payload includes canonical `hitboxes`, but the shared TypeScript return type erases that field. That makes several callers structurally unable to adopt server-minted IDs even though one modal works around it with a cast. I’m checking each surface for the resulting next-request failure sequence now.

1. **P1 — `saveHitboxes` returns canonical, ID-stamped hitboxes, but the client contract erases them.**

   - Server truth: [routes.py:2290](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:2290) returns `contentRevision`, `operationalRevision`, authoritative `hitboxes`, and obligations; the legacy path also returns persisted `hitboxes` at [routes.py:2303](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:2303).
   - Ignoring client contract: [editorApi.ts:695](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/editorApi.ts:695) declares only revisions, omitting `hitboxes`.
   - Ignoring callers:
     - [DogsCanvas.tsx:59](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/DogsCanvas.tsx:59) adopts only revisions.
     - [StepInpaint.tsx:355](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/StepInpaint.tsx:355) adopts only revisions.
     - [CutoutReviewPanel.tsx:930](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:930) adopts only revisions.
   - Working reference: the modal deliberately casts around the incorrect API type and adopts returned hitboxes at [GalleryReviewModal.tsx:382](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:382).
   - Breaking sequence: load a legacy/id-less hitbox → move it → server assigns/normalizes an ID → UI retains the anonymous object → next full-array save sends it anonymously again, allowing a new bird identity to be minted or rebound.
   - Severity: **P1** for migrated/mixed sessions; low for sessions already carrying stable IDs throughout.

2. **P1 — Gallery modal’s reducer revision and `sessionCache` revision diverge.**

   - Cache is returned indefinitely without refetch at [GalleryReviewModal.tsx:316](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:316).
   - Placement callback updates reducer state at [GalleryReviewModal.tsx:823](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:823), but not `sessionCache`.
   - Geometry updates reducer revision and cached hitboxes, but not cached revision at [GalleryReviewModal.tsx:895](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:895).
   - Hitbox and final approvals similarly update only reducer state at [GalleryReviewModal.tsx:1034](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:1034) and [GalleryReviewModal.tsx:1090](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:1090).
   - Breaking sequence: open level A at R1 → edit placement to R2 → navigate to B → return to A → cached A reloads R1 → next approval/geometry/save sends R1 and receives 409.
   - Severity: **P1**, normal navigation can revive a known-stale revision.

3. **P1 — Cutout panel does not synchronously adopt revisions from revert and embedded hitbox moves.**

   - Revert server response contains revisions at [routes.py:3434](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:3434).
   - Client only notifies the parent at [CutoutReviewPanel.tsx:828](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:828); it does not update `contentRevisionRef`.
   - Hitbox move has the same problem at [CutoutReviewPanel.tsx:930](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:930).
   - The ref is eventually synchronized by a later React effect at [CutoutReviewPanel.tsx:407](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:407).
   - Breaking sequence: revert or move succeeds R1→R2 → user immediately changes placement before parent render/effect → second request reads R1 and is refused. Revert reports only `Revert failed (409)` and does not adopt conflict truth.
   - Severity: **P1**, reproducible rapid-interaction race.

4. **P1 — `StepInpaint` sends concurrent full-array mutations using the same captured revision.**

   - Each gesture reads the query-cache revision and fires immediately at [StepInpaint.tsx:340](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/StepInpaint.tsx:340).
   - There is no queue, conflict reconciliation, or rejection handler at [StepInpaint.tsx:355](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/StepInpaint.tsx:355).
   - Breaking sequence: move A and B rapidly → both requests carry R1 → first commits R2 → second is rejected → UI retains the optimistic second move while server does not.
   - Severity: **P1**, ordinary rapid editing produces client/server divergence and possibly an unhandled rejection.

5. **P1 — `DogsCanvas` records in-flight saves but does not serialize later saves behind them.**

   - Revision is read immediately before each request at [DogsCanvas.tsx:59](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/DogsCanvas.tsx:59).
   - `inflightSaveRef` is written at [DogsCanvas.tsx:73](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/DogsCanvas.tsx:73), but another debounce timer can call `persistHitboxes` without awaiting it at [DogsCanvas.tsx:100](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/DogsCanvas.tsx:100).
   - Breaking sequence: first drag dispatches with R1 → second debounce fires before response → it also sends R1 → first commits R2 → second receives 409.
   - Severity: **P1**, likely during sustained dragging or slow server responses.

6. **P1 — Pending modal hitbox saves race bulk geometry.**

   - Geometry provides complete read-back truth at [routes.py:2373](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:2373), and the modal correctly adopts it at [GalleryReviewModal.tsx:895](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:895).
   - However, the geometry handler does not call the modal’s pending-save barrier before submitting.
   - Breaking sequence: drag at R1 → immediately click Grow/Clear. If geometry lands first, delayed save is refused; if save lands first, geometry is refused. Either the drag or explicitly selected operation appears to fail/snap.
   - Severity: **P1**.

7. **P1 — `approve-catalog` publishes whichever revision is current, not the revision reviewed by the caller.**

   - Endpoint has no `expectedContentRevision` at [routes.py:2879](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:2879).
   - Server returns package `contentRevision`, `catalogRevision`, and `catalogEntry` at [session.py:6031](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:6031).
   - Client discards the entire response by returning `Promise<void>` at [editorApi.ts:1129](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/editorApi.ts:1129); caller merely refreshes at [GalleryPage.tsx:871](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryPage.tsx:871).
   - Breaking sequence: gallery displays reviewed R1 → another surface changes and reapproves R2 → user clicks publish on stale card → server publishes R2, although this surface presented R1.
   - Additional split-commit risk: bundled-manifest update happens after catalog approval at [routes.py:2894](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:2894).
   - Severity: **P1**, wrong reviewed artifact can be shipped.

8. **P1 — Clone has no source-revision binding and returns no cloned canonical truth.**

   - Endpoint accepts only client-chosen `newId` and `resetPaint` at [routes.py:3595](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:3595).
   - Response contains only `sessionId`, `clonedFrom`, and `resetPaint` at [session.py:2271](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2271).
   - Compare UI starts clones without an expected revision at [ComparePanel.tsx:53](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/ComparePanel.tsx:53).
   - Breaking sequence: comparison clone begins while wizard saves source geometry → sequential file copying can capture mixed source generations → caller receives no content revision, hitboxes, or IDs with which to establish clone truth.
   - Severity: **P1**.

9. **P1 — Archive is revision-unaware and reports only partial multi-store truth.**

   - Server mutates archive state, preview/export state, and lineup state at [routes.py:4206](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:4206).
   - Response reports request-like archive fields plus `removedFromLineup` at [routes.py:4228](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:4228), with no content revision or full read-back.
   - Modal at least flushes pending saves before archive at [GalleryReviewModal.tsx:598](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:598); gallery-card archive has no barrier at [GalleryPage.tsx:920](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryPage.tsx:920). Both ignore the returned ID/variant/lineup result.
   - Breaking sequence: stale gallery tab archives while another surface edits/publishes; archive succeeds independently of the displayed revision and local state is changed from request intent rather than server read-back.
   - Severity: **P1**, especially because the operation spans multiple stores without CAS.

10. **P2 — `rerunStale` reuses one revision across dry-run and confirmation, then ignores conflict truth.**

    - Server compares the revision at [routes.py:2412](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:2412) and returns queued stable bird IDs, job ID, and obligations at [routes.py:2442](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:2442).
    - Client type drops `reportedObligations` at [editorApi.ts:683](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/editorApi.ts:683).
    - Modal reuses the original revision after the confirmation dialog at [GalleryReviewModal.tsx:937](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:937), without flushing hitbox saves or adopting `actualContentRevision` on conflict.
    - Breaking sequence: dry-run succeeds at R1 → pending edit or another surface commits R2 during confirmation → paid start uses R1 and is refused.
    - Severity: **P2**; refusal is safe but disrupts a paid workflow.

11. **P2 — Sprite-placement CAS is mostly sound, but its conflict retry can bypass fresh human review.**

    - Canonical server returns sprite/cleanup geometry and revisions at [routes.py:1422](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:1422).
    - Panel globally queues saves and adopts successful geometry/revisions at [CutoutReviewPanel.tsx:488](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:488).
    - On 409 it adopts `actualContentRevision` and retries the same action automatically at [CutoutReviewPanel.tsx:507](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:507).
    - Breaking sequence: tab A edits candidate X at R1→R2; tab B, still showing R1, moves X → conflict handler adopts R2 and retries without showing B the intervening X change. Backend context-aware rebase should reject same-bird conflicts, but the client’s policy remains unsafe if that context check weakens or classifies incorrectly.
    - Severity: **P2** defense-in-depth; independent-bird rebases are legitimate.

12. **ID-adoption symmetry summary.**

    1. `LevelCanvas` is symmetric: both add paths mint UUIDs at [LevelCanvas.tsx:796](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/LevelCanvas.tsx:796), and move/remove carry captured IDs.
    2. `DogsCanvas` current adds are symmetric: it re-mints with `newDogId()` at [DogsCanvas.tsx:228](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/DogsCanvas.tsx:228). Its failure is normalization read-back for pre-existing anonymous data.
    3. `StepPlaceDogs` auto-place correctly adopts server-returned arrays at [StepPlaceDogs.tsx:234](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/StepPlaceDogs.tsx:234) and [StepPlaceDogs.tsx:251](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/StepPlaceDogs.tsx:251). The type incorrectly describes them as ID-less geometry at [editorApi.ts:635](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/editorApi.ts:635), though runtime IDs survive.
    4. `CutoutReviewPanel` placement saves are identity-addressed by `candidate.id` and adopt returned boxes/revisions at [CutoutReviewPanel.tsx:495](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:495). Its embedded full-array hitbox move is asymmetric as covered in finding 1.

13. **Endpoint coverage with no additional ignoring-client defect found.**

    - `runGeometryOperation`: strongest pair—required revision, authoritative hitboxes, revisions, and obligations are returned and adopted.
    - `setHitboxApproval`: returned revision is adopted, but only into reducer state; therefore covered by the dual-authority defect.
    - `setFinalCutoutApproval`: returned revision is adopted; its 409 path correctly requires fresh review at [GalleryReviewModal.tsx:1094](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/GalleryReviewModal.tsx:1094), but cache divergence remains.
    - `revert-sprite`, `archive`, `clone`, and `approve-catalog` lack sufficient read-back/CAS contracts as detailed above.

This was a read-only audit; no files were modified. Three parallel reviewers covered server contracts, revision ownership, and ID symmetry.

