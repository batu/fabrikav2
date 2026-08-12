# FTB Level Editor Job Infrastructure Correctness Review

Verdict: **Not ready**. I found eight P1 and four P2 correctness defects. The most serious risks are duplicate paid work, successful paid units being erased during retries, and jobs remaining permanently `running` after a quick restart.

Review was read-only. Existing unrelated workspace changes were excluded.

## P1 — High severity

### 1. A quick server restart can leave claimed jobs permanently `running`

[JobWorker.start()](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_worker.py:124) runs recovery only once. Recovery ignores jobs whose heartbeat is younger than 60 seconds at [job_worker.py:166](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_worker.py:166) and [job_worker.py:218](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_worker.py:218).

After startup, the worker only claims `queued` jobs at [job_worker.py:158](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_worker.py:158) and [job_store.py:524](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_store.py:524); stale recovery is never repeated.

A crash followed by an immediate supervisor restart therefore skips the dead worker’s recently heartbeating job forever. Once it becomes stale, nothing revisits it.

Fix: recover jobs owned by the dead worker immediately after acquiring the process lock, or periodically rerun owner-aware stale recovery. Use an owner/attempt CAS so a live attempt cannot be stolen.

### 2. Retry requests can requeue an already-running paid attempt

The start endpoints perform a separate idempotency lookup followed by an unconditional requeue:

- Background: [inpaint.py:2274](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:2274)
- Crop inpaint: [inpaint.py:2841](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:2841)
- Band generation: [inpaint.py:3521](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:3521)
- Failed-bird retry: [inpaint.py:4369](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:4369)

[requeue_job()](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_store.py:620) accepts every source status and clears provider markers and results.

Two requests can both observe `failed_retryable`; the first requeues the job and the worker starts paid work, then the second requeues that now-`running` row and makes it claimable again.

Fix: make lookup plus requeue one transaction, accepting only explicit terminal source statuses. Use `UPDATE ... WHERE status = ? AND updated_at = ?` or an attempt generation; return the current row when the CAS loses.

New-row creation itself is correctly serialized by `BEGIN IMMEDIATE` and the unique index at [job_store.py:323](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_store.py:323). The race is specifically the later lookup-to-requeue operation.

### 3. Partial retries erase and regenerate successful paid units

[_should_requeue_failed_generation_job()](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:2258) permits requeue when a partial result exists. Requeue then clears the parent result at [job_store.py:633](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_store.py:633).

Background preparation requeues every child that is not already `queued`, including `succeeded`, at [inpaint.py:2317](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:2317). Crop preparation does the same at [inpaint.py:2953](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:2953). Both handlers then execute every unit again.

Consequences:

- Successful child results lose their durable attribution.
- Previously paid options are submitted again.
- Existing files can be overwritten by the retry.
- The parent aggregate no longer distinguishes reused successes from new work.

The failed-bird retry path demonstrates the correct model by retaining successful children and skipping their provider calls at [inpaint.py:4793](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:4793).

Fix: retain successful child rows/results, reconstruct the parent aggregate from them, and execute only failed or unresolved units.

### 4. Job transitions are unrestricted last-write-wins

[transition_job()](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_store.py:389) updates by job ID only. It has no allowed source state, expected attempt, or worker-owner predicate.

Similarly, worker exception handling writes terminal states unconditionally at [job_worker.py:268](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_worker.py:268).

A stale attempt can therefore:

- Finalize a job after a newer attempt has been queued or claimed.
- Overwrite cancellation or manual orphaning.
- Attach its result to the wrong attempt.
- Mark a newly running retry failed because the prior handler raised late.

Fix: store an attempt generation and require it, the expected status, and worker owner in every execution transition. Encode and enforce an explicit transition graph.

### 5. Provider timeouts start another attempt while the first paid call keeps running

[_with_retries_and_timeout()](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:420) submits provider work to `_timeout_executor`. If `Future.result()` times out and `cancel()` returns false, the first provider call continues at [inpaint.py:459](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:459), while the retry loop starts another attempt after backoff.

The semaphore prevents over-admission but does not prevent duplication when another permit is available. The first call’s eventual successful result is discarded.

Fix: do not retry an attempt whose underlying call cannot be cancelled conclusively. Prefer provider request IDs and polling; otherwise mark the attempt `orphaned_unknown` and reconcile it before another charge.

### 6. Variant filenames are allocated under the lock but written after releasing it

Crop processing scans for the next variant under `_session_lock`, releases the lock, and then writes the selected path at [inpaint.py:3201](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:3201). Regeneration repeats the pattern at [inpaint.py:4018](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:4018).

The allocator itself says locking is required “for atomicity” at [session.py:4550](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:4550), but the lock protects only the scan—not reservation or creation.

Concurrent work for the same bird can choose the same index and race over:

- `variant_NNN.png`
- Generation sidecar
- Variant box
- Sprite PNG and metadata
- `activeVariant`

Fix: reserve the filename atomically or retain the per-session/bird lock through all related artifact creation and session-state publication.

### 7. Hitbox recentering can overwrite concurrent edits and corrupt sprite metadata

[recenter_hitboxes_local_diff()](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:5810) reads `hitboxes.json` before a long image-analysis pass. It later writes sprite JSON directly and non-atomically at [inpaint.py:5914](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:5914) and [inpaint.py:6013](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:6013), then saves its old full hitbox snapshot at [inpaint.py:6021](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:6021).

`save_hitboxes()` locks only the final write. It cannot protect the much earlier read. A concurrent UI move, delete, reorder, or cutout update can consequently be lost or resurrected; readers may also observe truncated sprite JSON.

Fix: compute against an immutable snapshot, then reacquire the lock and verify a content revision/hash before applying. Write all sprite metadata atomically.

### 8. Magenta mode bypasses the durable job system

The UI uses durable POST-plus-poll only for crop mode at [useInpaintStream.ts:227](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/useInpaintStream.ts:227). Magenta still opens a side-effectful EventSource at [useInpaintStream.ts:256](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/useInpaintStream.ts:256).

The backend runs `run_magenta_inpaint()` directly inside the SSE generator at [inpaint.py:6280](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:6280), despite having a registered durable `magenta_inpaint` handler at [inpaint.py:3683](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:3683).

A server restart or stream loss leaves no stored job ID for resume, inspection, or safe retry, even after a paid call started.

Fix: route magenta through the existing durable start/status mechanism and store its job ID in the same UI recovery layer as crop mode.

## P2 — Moderate severity

### 9. Cutout jobs disappear from the UI on panel unmount

Cutout job state exists only in component state at [CutoutReviewPanel.tsx:312](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:312). Cleanup aborts polling at [CutoutReviewPanel.tsx:570](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:570), but the durable server job continues.

The job ID is neither persisted nor rediscovered on remount. Switching review mode, navigating, or closing the modal therefore hides the active job and enables another paid request.

Fix: persist active job IDs per session/bird, discover active jobs on mount, and keep the action disabled until the canonical job reaches terminal state.

### 10. One transient polling failure permanently stops tracking

Crop polling treats any failed status/session request as final UI failure and schedules no retry at [useInpaintStream.ts:145](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/useInpaintStream.ts:145). It leaves the job ID in local storage because removal happens only after observing a terminal state.

Cutout polling similarly lets one request error escape the loop at [CutoutReviewPanel.tsx:278](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/CutoutReviewPanel.tsx:278).

A brief restart or network loss can therefore make the UI report failure while the paid job continues and succeeds. Cutout controls can then start duplicate work.

Fix: distinguish transport errors from terminal job failures; retry with bounded backoff and keep the stored job identity until a terminal status is observed.

### 11. Crop resume depends on `StepInpaint` being mounted

Although `App` owns the long-lived hook, it does not call `resume` during session restoration at [App.tsx:120](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/App.tsx:120). Resume occurs only in the conditional `StepInpaint` mount effect at [StepInpaint.tsx:215](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/components/StepInpaint.tsx:215).

If restored session state does not render that step—particularly before the worker has persisted visible dog progress—the stored job is never polled.

Fix: invoke crop-job resume from `App` immediately after restoring the session, alongside background-job recovery.

### 12. Per-session SSE can close without a terminal failure event—and the UI may report success

The crop stream emits only semantic progress events at [inpaint.py:3699](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:3699). Generic `job.failed_*`, `job.orphaned_unknown`, and `job.cancelled` transitions are filtered out, and the stream returns when it sees a terminal job at [inpaint.py:3715](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/inpaint.py:3715).

If the worker fails before appending `inpaint_complete`, the client gets EOF/onerror without the terminal reason. Its reconciliation path treats any successful session GET as successful completion at [useInpaintStream.ts:291](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/ui/src/api/useInpaintStream.ts:291), without reading the job’s status.

Fix: emit a canonical terminal event containing status/error after the tail drain, or make the client reconcile against the durable job endpoint and derive success strictly from `job.status === "succeeded"`.

## Additional observations

- `/jobs/{id}/events` at [routes.py:933](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/routes.py:933) is cursor-based JSON polling, not SSE. It does expose durable transition events correctly.
- The background and crop SSE tail-drain logic does close the event-vs-terminal read race. The defect is that terminal transition events are excluded from the semantic stream.
- Restart “resume” after provider submission is currently conservative orphaning, not actual resume: [job_worker.py:230](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/job_worker.py:230). No provider ID polling/download resumption is implemented.
- Legacy first hydration writes `hitboxes.json` outside `_session_lock` and non-atomically at [session.py:2674](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2674) and [session.py:2779](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/session.py:2779).
- Shutdown can block indefinitely on running provider calls because lifespan uses `shutdown(wait=True)` at [server.py:256](/Users/base/dev/appletolye/fabrikav2/tools/level-editor/levelbuilder/api/server.py:256), even after the durable worker’s bounded join gives up.
- I found no semaphore over-release in the reviewed provider path; the running future releases its own permit, while cancel-before-start releases at the caller.

Three independent review passes covered store/restart semantics, executor/locking behavior, and SSE/UI recovery, followed by direct end-to-end synthesis.

