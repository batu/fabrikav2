I’ll inspect the editor UI specifically for unverified persistence claims and failure paths. I’m using the code-review skill because this is a report-only bug hunt with exact findings, not an implementation request.

The review workflow requires independent parallel reviewers for this class of async/state bug hunt, so I’ll use them to cross-check separate UI areas and then deduplicate the evidence. First I’m finishing the workflow instructions and establishing the exact source inventory and dirty-state boundary.

Review scope is the entire current `tools/level-editor/ui/src` tree; the unrelated dirty files shown by Git are excluded and untouched. The deep pass is splitting persistence/caching, modal/canvas state, and archive/generation flows; I’m also scanning all request call sites locally for cross-file state transitions.

1. **P0 — `tools/level-editor/ui/src/components/DogsCanvas.tsx:59-70, 73-87, 232-237`**

   Moves and new hitboxes are written optimistically into the shared query cache. A rejected debounced save is swallowed without rollback, refetch, or dirty state. The canvas continues showing the local geometry as current while the server retains the old hitboxes; human placement work disappears on reload or navigation.

2. **P0 — `tools/level-editor/ui/src/components/DogsCanvas.tsx:92-97, 282-287`**

   `settleSaves()` uses `Promise.allSettled`, so a failed placement save still permits paid regeneration to start. The user sees regeneration operating on the displayed location, but the backend uses the old persisted coordinates.

3. **P0 — `tools/level-editor/ui/src/components/StepInpaint.tsx:340-365`**

   The inpaint canvas immediately replaces cached `hitboxes` and `dogs`, then fires `saveHitboxes()` without rejection reconciliation. A failed move/add/remove remains rendered even though the server state is unchanged, so human geometry can be silently lost later.

4. **P0 — `tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:530-541, 554-587`**

   Padding and sprite-placement boxes update locally before a one-second debounced save. Failure only displays an error and then clears the pending indicator; it neither restores server boxes nor marks them dirty. The rejected placement remains rendered as canonical-looking geometry.

5. **P0 — `tools/level-editor/ui/src/components/DogRegenList.tsx:239-246`; `tools/level-editor/ui/src/components/StepInpaint.tsx:141-157`**

   Variant selection or exclusion updates cached `activeVariant` before persistence. The API failure is silently caught with the explicit comment that the local cursor already moved. The UI therefore highlights a rejected variant—or shows the entity excluded—while the server retains the previous choice.

6. **P0 — `tools/level-editor/ui/src/components/GalleryReviewModal.tsx:348-408`**

   After `persistHitboxes()` resolves, `result.hitboxes ?? hitboxes` treats an absent server hitbox body as proof that the submitted local array persisted. Those local values are installed into `sessionCacheRef` and rendered as server truth, allowing navigation and later operations without authoritative read-back.

7. **P1 — `tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:487-533`**

   Starting another placement save does not clear `lastResult`. After that save fails, the previous “placement saved” message remains visible beside the newly rejected optimistic geometry. The success message describes an older request while the canvas shows the failed one.

8. **P1 — `tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:919-938`**

   A hitbox move announces exact new coordinates after the POST, but it neither updates the parent hitbox array nor reads back authoritative geometry. The subsequent render can show the old circle while claiming the new coordinates were saved, and that stale local value can drive a later overwrite.

9. **P1 — `tools/level-editor/ui/src/components/GalleryReviewModal.tsx:598-613`; `tools/level-editor/ui/src/components/GalleryPage.tsx:920-928`**

   Archive/unarchive ignores the returned `{ archived, variant }` body and updates local state from the requested value. The modal additionally emits `✓ Archived`/`✓ Unarchived`. A normalized, no-op, or otherwise different effective response leaves the gallery asserting the requested state instead of server truth.

10. **P1 — `tools/level-editor/ui/src/api/useBgStream.ts:334-352`**

    A malformed `generate_complete` payload—or one missing numeric `failed`—defaults to zero failures, marks the job `succeeded`, closes the stream, and starts upscale. A corrupt completion event is therefore converted into verified-looking generation success without job read-back.

11. **P1 — `tools/level-editor/ui/src/api/useInpaintStream.ts:451-477`**

    `magenta_complete` synthesizes every cached dog as `done`, appends the event’s `colorFile`, and sets progress to N/N without fetching the session. The editor can show its all-complete UI solely from an SSE event even when durable session/artifact state has not been confirmed.

12. **P1 — `tools/level-editor/ui/src/components/StepPlaceDogs.tsx:163-176`; `tools/level-editor/ui/src/components/GalleryReviewModal.tsx:513-524`**

    Failed mobile-visibility verification is represented as `visibilityIssues = []`. All blocker indicators disappear, visually claiming “no device visibility problems” when the truthful state is “verification unavailable.”

13. **P1 — `tools/level-editor/ui/src/components/SpriteAnimationWizard.tsx:57-60, 297-310`**

    A completed job displays “Preview ready,” and `previewUrl()` accepts any non-null path without checking `previewExists`. It can therefore claim readiness and render a broken video even when the server explicitly reports `previewExists: false`.

Three independent read-only reviewers covered persistence/cache flows, modal/canvas mutations, and archive/generation paths. No files were changed.

