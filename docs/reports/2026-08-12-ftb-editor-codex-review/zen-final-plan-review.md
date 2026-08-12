I’m using the document-review skill for this final freeze audit. I’ll read its instructions, inspect the entire plan with line numbers, and cross-check the current routes/scripts and relevant packer checks where O11 makes concrete implementation claims.

This is a plan-shaped, high-risk architectural review. The skill calls for coherence, feasibility, scope, design, and adversarial coverage; I’m running the most relevant reviews in bounded parallel while I independently trace O11 against the repository. No edits will be applied—the requested output is report-only.

The first full pass confirms the freeze risk is not cosmetic: the file’s “10-step order” omits O1/O2 and O3–O11 placement, P1.6 has no standalone contract, and the overnight directive contains human/paid/device gates that cannot be completed unattended as written. I’m now pinning each finding to the smallest textual correction and concrete repository seam.

BLOCK

1. **Authoritative execution order — Order & estimates / Phase 6 / Document structure note (lines 486–507, 646–733, 743–748).**  
   Zen: “There should be one—and preferably only one—obvious way.”  
   The stated runbook is the 10-step order plus O1/O2/O11, but O1/O2 are not inserted into that order, while O3–O10 are required after Phase 2 yet omitted from it. “Read top-down = execute” is false.  
   **Smallest fix:** replace the order with one binding checklist that explicitly places O1–O11 among steps 1–10 and labels everything else reference-only or deferred.

2. **Conflicting binding orders — A5 vs amended order (lines 486–502, 535–538).**  
   Zen: “Explicit is better than implicit.”  
   A5 mandates resolver → hydration → reads → generation consumers → shakedown → projection demotion. The amended order inserts read-back and geometry, places publication before shakedown, and combines stages differently without saying it supersedes binding A5.  
   **Smallest fix:** make the unified checklist the sole authority and replace A5 with a pointer to it.

3. **P1.6 is not an executable contract — Step 4 / F-A (lines 492–494, 554–561).**  
   Zen: “If the implementation is hard to explain, it’s a bad idea”; “Explicit is better than implicit.”  
   P1.6 is load-bearing but exists only as “one CAS-aware geometry mutation service.” It does not define operations, request/response schema, expected revision, atomicity, identity add/delete, canonical-state behavior, no-op semantics, review invalidation, human override, derived-stale ownership, or rejection/read-back reconciliation.  
   **Smallest fix:** add P1.6 beside P1.5 with:

   - operation enum: move/add/delete/clear/scale/recenter/import/repair;
   - expected-revision and canonical-state requirements;
   - atomic snapshot result and error codes;
   - no-op/review/human-authority rules;
   - checked-in writer census;
   - one contract test per operation and writer.

4. **Canonical-first scope is nested in amendments — Phase 1 vs A1/A2/F-A (lines 39–66, 511–522, 554–561).**  
   Zen: “Flat is better than nested”; “Special cases aren’t special enough.”  
   Hydration, overlays, gallery aggregation, candidate lookup, asset integrity, and writer conversion are binding only in later prose. An executor can satisfy the original Phase 1 list while omitting them.  
   **Smallest fix:** fold A1, A2, and P1.6 directly into Phase 1 and replace its exit criteria with consumer- and writer-matrix completion.

5. **Projection has four incompatible terminal states — P1.4 / Phase 1 exit / ledger / A1 / step 7 (lines 48–66, 442–445, 497–498, 511–517).**  
   Zen: “Errors should never pass silently.”  
   The projection may remain for export, may have two references, must be deleted, or merely be demoted.  
   **Smallest fix:** choose one state. If retained, name the exact allowed call sites and boundary test. If deleted, require zero references. Remove `grep <= 2` as the semantic gate.

6. **Geometry supersession remains unsafe — vNEXT vs CL-6/CL-8/CL-9 (lines 236–265, 338–362).**  
   Zen: “There should be one obvious way.”  
   vNEXT requires resolved legacy effective radius—not raw ×2—and removes runtime bisector geometry. CL-6 orders raw ×2; CL-8 retains neighbor clamping; CL-9 says “the bisector STAYS” and specifies a different dissolve algorithm. A later executor can reasonably implement the imperative CL text.  
   **Smallest fix:** replace CL-6, CL-8, and CL-9 with `SUPERSEDED — implement Geometry vNEXT §5/§4`; delete their old algorithms. Make step 4 explicitly name vNEXT as authoritative.

7. **Unset geometry values require guessing — vNEXT / R11 / execution decision 4 (lines 255–271, 479–481, 499–500).**  
   Zen: “Refuse the temptation to guess.”  
   Dense-grid resolution, perceptual threshold, uniformity band, body-coverage percentage, residue threshold, and tap-radius limits are absent. The plan says enforcement requires operator approval while step 8 includes tolerances.  
   **Smallest fix:** split step 8 into:

   - 8a: autonomous measurement and a checked-in proposal;
   - 8b: explicitly blocked until the named operator approves exact values.

8. **Obligation semantics contradict commit semantics — Obligation edges (lines 280–306).**  
   Zen: “Simple is better than complex”; “Flat is better than nested.”  
   The plan says no operation commits until obligations finish, then describes human-hitbox re-derivation as a post-write staleness edge that does not auto-run.  
   **Smallest fix:** split the table into `commit-blocking obligations` and `post-commit stale descendants`; define commit, approval, and export gates independently.

9. **Transactional Start promises impossible cross-system atomicity — P2b.2 vs O3 (lines 84–86, 685–687).**  
   Zen: “Practicality beats purity.”  
   R2 uploads, remote read-back, local filesystem installation, and editor state cannot form a transaction that leaves all disk/remote state untouched on failure.  
   **Smallest fix:** specify immutable staging, manifest-last as the sole visibility commit point, local-state commit after remote read-back, and cleanup/retention of orphaned staged objects.

10. **The Start button and CLI do not currently share the complete path — O11.1 (lines 716–719).**  
    Zen: “There should be one obvious way.”  
    The concrete divergence is:

    - UI persists its draft and posts `/api/sequence-workflow/start`, with user-selectable `dynamicBundle`.
    - CLI conditionally calls `approve-catalog`, calls `/sessions/{id}/bundle`, rewrites the draft, then posts Start with `dynamicBundle=False`.
    - The shared path begins only inside the Start endpoint; approval/export/draft/bundle composition remains separate.

    **Smallest fix:** name one server-side `ReleaseService.release(ReleaseRequest)` that owns approval/export, revision allocation, asset selection, draft/order, bundle projection, upload, read-back, local installation, and live-state commit. UI and CLI must be thin adapters to one `/release` endpoint, with an adapter-parity contract test.

11. **O11 leaves direct mutation surfaces alive — O11.1/O5 (lines 690–719).**  
    Zen: “Errors should never pass silently.”  
    Surviving bypasses include `approve-catalog`, `apply-bundle-projection`, bundled-manifest/order routes, levels-index mutation, `publish_ftb_cdn.py`, and direct imports of their writers. “Become internals or die” is not checkable.  
    **Smallest fix:** enumerate every route, script, and mutation function to delete, return 410, or place behind the release capability. Add OpenAPI, operation-registry, and subprocess tests proving only `/release` can change order, revision, manifests, or R2 state.

12. **A bypass survives all four O11 layers — O11 (lines 710–733).**  
    Zen: “Errors should never pass silently.”  
    Direct filesystem mutation followed by updating embedded digests; direct HTTP to surviving routes; inline Python imports; or direct R2 writes from another host bypass CLI, skill, and hooks. If no subsequent build/CI/release gate runs, the mutation remains undetected. Raw R2 credentials are an unavoidable administrative bypass.  
    **Smallest fix:** move authority to an authenticated server-side release capability; remove routine raw credentials; recompute rather than trust embedded digests; require release completion to read back R2 revision and digest. State explicitly what raw-credential holders can still bypass.

13. **O11 orders its enforcement layers backwards — O11 introduction (lines 715–729).**  
    Zen: “Practicality beats purity.”  
    CLI is described as strongest, but it is the easiest layer to bypass. Skills and hooks are advisory.  
    **Smallest fix:** order the layers as server authority → recomputation/read-back gates → CLI/UI adapters → documentation/hooks, or stop labeling them strongest-first.

14. **Break-glass reconciliation is not checkable — O11 break-glass (lines 730–733).**  
    Zen: “Explicit is better than implicit”; “Errors should never pass silently.”  
    There is no invariant enum, required reason, marker path/store, schema, atomic creation point, gate list, clearing command, or reconciliation proof. A raw bypass creates no marker; a local file can be deleted or absent on another machine.  
    **Smallest fix:** define an append-only server-side release journal entry containing release ID, closed invariant enum, reason, actor, timestamps, before/observed revision and digest, status, and evidence. Write `OPEN` before bypass. Only `ftb reconcile <id>` may close it after local recomputation, R2 read-back, and bundle verification. `/release`, `build:ios`, and CI must all refuse any open entry.

15. **Digest gates duplicate existing integrity checks unless separated — O11.2/O6 (lines 692–693, 720–724).**  
    Zen: “There should be one obvious way.”  
    The existing native packer already recomputes each referenced asset’s hash/size and raises the “changed after approval” failure. That should remain the asset-integrity gate. A canonical manifest digest is a different order/revision/provenance binding.  
    **Smallest fix:** define two explicit checks in one validator:

    1. recomputed asset hash/size equals the canonical approved entry;
    2. canonical manifest byte digest equals each derivative’s `sourceManifestDigest`.

    Specify canonical serialization and exclusion of any self-referential digest field.

16. **“Copy canonical manifest unchanged” conflicts with current packer behavior — O6/O11.2 (lines 692–693, 720–724).**  
    Zen: “Explicit is better than implicit.”  
    The packer currently rewrites bundled flags and asset metadata. An unchanged manifest also cannot contain its own byte digest. WebPs do not naturally carry this provenance.  
    **Smallest fix:** require deletion of the rewrite functions, assert exact manifest byte equality, and store `sourceManifestDigest` in separate build provenance metadata/sidecars.

17. **Storage non-goal is false — Non-goals vs planned schemas (lines 29–34 and throughout P2b–P2e/vNEXT/O4).**  
    Zen: “Errors should never pass silently.”  
    Recipe serialization, lifecycle state, human provenance, obligations, restore ownership, ManifestV2, and digests are storage/schema changes.  
    **Smallest fix:** change the non-goal to “no replacement of the canonical revision-store architecture or frozen runtime compatibility fields,” then list the intended versioned migrations.

18. **State-machine vocabulary disagrees — P2b.4 vs mining summary (lines 89–94, 611–614).**  
    Zen: “Explicit is better than implicit.”  
    One uses `needs-review`; the other uses `review`.  
    **Smallest fix:** define the enum once and make every reference use it.

19. **The plan understates its scope — Non-goals / total estimate (lines 31–34, 504).**  
    Zen: “Simple is better than complex”; “Special cases aren’t special enough.”  
    This is not merely canonical-read simplification plus invariants. It includes durable job semantics, lifecycle redesign, recipe/experiment/cost systems, geometry/runtime changes, deployment consolidation, release infrastructure, CDN authority removal, and enforcement tooling.  
    **Smallest fix:** either list these as first-class scope or split canonical editor, geometry, and release unification into dependent plans.

20. **The overnight promise contradicts the estimate and gates — Execution decisions / estimate (lines 467–484, 504).**  
    Zen: “Practicality beats purity.”  
    “Finished by morning” conflicts with approximately eight working days and multiple paid, human, external-service, deployment, and physical-device gates. Parking blockers does not make the goal finished.  
    **Smallest fix:** replace “finished by morning” with an explicit overnight tranche and morning decision queue.

21. **Every amended step lacks a fully mechanical exit — Order (lines 488–507).**  
    Zen: “Refuse the temptation to guess.”

    1. **Step 1:** no caller matrix or assertion for every canonical-state class.  
       **Fix:** name resolver callers, fixtures, states, error codes, and test commands.
    2. **Step 2:** “canonical overlay,” “read surfaces,” and “DAG data model” lack enumerated consumers and pass predicates.  
       **Fix:** name the consumer-matrix path and require every row’s converted/tested status.
    3. **Step 3:** “every mutation endpoint” and provenance strip are not enumerated.  
       **Fix:** list endpoints/UI consumers and exact returned revision assertions.
    4. **Step 4:** “all writers” has no census; P1.6 has no contract; reclamation relies on three unnamed levels.  
       **Fix:** writer matrix, formal P1.6, exact protected IDs and scripted proof.
    5. **Step 5:** kill-9/no-double-bill proof lacks command, timeout, ledger oracle, and durable evidence path.  
       **Fix:** commit the stress script and define terminal ledger assertions.
    6. **Step 6:** lifecycle migration and transactional Start lack illegal-state fixtures and filesystem/remote assertions.  
       **Fix:** enumerate legal transitions, migration mapping, failure injection, and visible commit point.
    7. **Step 7:** paid regeneration, scratch lineup, republish, credentials, device/build, read-back, and evidence location are unspecified.  
       **Fix:** name IDs, commands, authorization, expected revision/digest/order, and capture paths.
    8. **Step 8:** no recipe schema, meter query, contact-sheet validity predicate, or approved tolerance values.  
       **Fix:** name schema/test fixtures and split proposed versus approved tolerances.
    9. **Step 9:** “API stabilizes” is subjective; portal cutover lacks smoke, rollback, and authorization gates.  
       **Fix:** exact health/hash/proxy checks and explicit deploy consent.
    10. **Step 10:** census roots/command are absent; backfill deletion remains undecided; pruning has no reviewed allowlist.  
        **Fix:** bind the recovery decision or stop before deletion; name census command/roots and deletion allowlist.

22. **Critical terms exist only in conversation, reports, or scratch state — throughout.**  
    Zen: “Explicit is better than implicit.”  
    Undefined execution inputs include:

    - the three protected unreviewed level IDs;
    - scratch lineup ID;
    - stress-rig instructions stored only in “session scratchpad notes”;
    - consumer-matrix exact path;
    - golden-set path/version;
    - Merceka ledger interface and credential requirements;
    - panel/gallery/golden-path smoke commands;
    - canonical recipe end-to-end;
    - reviewed-authoring identity;
    - accepted diff and restoration-review state;
    - original neighbor set and dense-grid resolution;
    - core-body threshold and uniformity band;
    - recorded-live-run artifact path;
    - explicit decision owner/marker for radius outliers and backfill retirement.

    **Smallest fix:** add a glossary/resources table mapping every term to an exact value, code symbol, path, command, or `BLOCKED: owner + required input`.

23. **Step 7 depends on functionality scheduled for step 8 — execution decision 5 / order (lines 482–500).**  
    Zen: “There should be one obvious way.”  
    Step 7 must regenerate through the canonical recipe end-to-end, but the recipe and CLI/UI parity are built in step 8.  
    **Smallest fix:** move the minimal versioned recipe and shared release/regeneration operation before step 7; retain experiment UI and cost presentation in step 8.

24. **Step 10 requires an unresolved human decision — A4 / pre-verification / order (lines 530–533, 627–632, 502).**  
    Zen: “Refuse the temptation to guess.”  
    The runbook says Phase 3 deletion, while the plan still requires an explicit decision whether geometric rebinding remains a recovery tool.  
    **Smallest fix:** bind keep/move/delete now, or make overnight execution stop before that deletion and produce a decision packet.

25. **On-device gates are not operational definitions — Phase 6 device gate (lines 706–708).**  
    Zen: “Errors should never pass silently.”  
    “Observed on-phone order” lacks device, exact installed build, online/offline procedure, manifest read-back, capture artifact, and pass predicate.  
    **Smallest fix:** name the device/build/install/launch commands, online/offline sequence, expected order/revision/digest, and screenshot/video/log artifact paths.

## Lens 4: overnight executability

**Executable unattended, assuming local dependencies already work:**

- Step 1: resolver and state-classifier code plus deterministic tests.
- Step 2: canonical hydration/read conversion and DAG schema/tests, once the consumer matrix path and exits are added.
- Step 3: read-back/provenance code and automated UI/API tests.
- Step 4: geometry-service implementation and deterministic contract tests, excluding real-level reclamation.
- Step 5: generation-boundary and job-store unit/integration hardening without live paid-provider proof.
- Step 6: publication/lifecycle implementation and failure-injection tests without live publication.
- Step 8a: recipe schema, experiment manifest, golden-pair plumbing, evidence generation, and tolerance measurement/proposal only.
- Step 10: census re-check and allowlisted noncontroversial pruning/verbiage work, stopping before undecided recovery deletion.
- O1/O2: app freshness and bundle-budget code/tests.
- Most O11 implementation once its authority, journal, and digest contracts are written.

**Not executable unattended:**

- Step 4’s reclamation proof: needs the exact three protected level IDs and deliberate editor/device review actions.
- Step 5’s live paid/provider crash proof: needs credentials, spend authority, provider-state oracle, and a defined failure drill.
- Step 7 in full: needs paid-generation authorization, exact scratch lineup, live credentials, external publication authority, `uk_cotswolds_3a43` mutation approval, and real-device evidence.
- Step 8b tolerance enforcement: explicitly needs operator approval of proposed R11 values.
- Human-labeled experiment winner adoption: needs a human selection.
- Step 9 portal cutover: needs separate-repo coordination and production deploy/cutover authority.
- Step 10 recovery-tool deletion: needs the unresolved keep/move/delete decision.
- O3–O10: need R2 credentials, release-revision authority, external mutation authorization, app build/install, and physical-device online/offline verification.
- Any break-glass use: needs a named invariant, reason, authorized actor, and reconciliation evidence.

This autonomous/operator partition is not stated anywhere. The plan currently treats “park blockers” and “finished by morning” as compatible; they are not.