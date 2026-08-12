# Final pre-execution review

Verdict: **NOT READY for unattended paid execution as written.**

The core design is viable, but the accumulated amendments do not yet form one authoritative execution contract. An autonomous agent could reasonably:

- Continue from step 4 into the entire eight-day plan.
- Implement superseded geometry behavior.
- Bake radii or enforce unapproved R11 values.
- Touch the three protected levels.
- Delete the projection prematurely.
- Run paid batches without spend or retry limits.
- Republish through publication code the plan itself calls unsafe.
- Claim the obligation DAG complete before durable-job support exists.

Review coverage: coherence, feasibility, scope containment, and adversarial unattended-execution review. Three reviewer agents ran; no files were edited.

## 1. Internal contradictions

### P0 — Overnight scope versus the ten-step order

“Finished by morning” and “never stop while unblocked work remains” provide no stopping boundary ([lines 467–472](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:467)). The only authoritative-looking order contains ten steps totaling approximately eight working days ([lines 486–504](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:486)).

An unattended executor is therefore instructed to continue into steps 5–10, including excluded phases.

**Required correction:** add a supremacy clause and exact overnight allowlist/denylist. “Never stop” must mean “continue through remaining independent allowlisted overnight items,” not the whole plan.

### P0 — Recipe/shakedown dependency cycle

The overnight decision calls `uk_cotswolds_3a43` a canonical-recipe end-to-end shakedown ([lines 482–484](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:482)), but:

- Generation/job-store work is step 5.
- Publication integrity is step 6.
- The shakedown is step 7.
- Recipe implementation is step 8.

([lines 495–500](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:495))

The shakedown cannot both precede the recipe and exercise it. It also cannot honestly be the existing “step 7” while steps 5–6 are excluded.

**Required correction:** define a minimal overnight recipe-schema slice and rename this a narrower overnight CLI shakedown. Do not claim the full step-7 gate has passed.

### P0 — Tap-radius gate contradicts geometry vNEXT

Geometry vNEXT requires:

- Dense tap-equivalence testing.
- Uniformity/outlier disposition.
- Body-mask coverage.
- Determinism and provenance freshness.

([lines 255–271](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:255))

The execution decision instead makes the equivalence grid the gate “alone” ([lines 473–475](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:473)).

**Required correction:** because the requested overnight policy is “radius bake must not land,” prohibit all data/runtime radius changes tonight. Measurement and test-harness work may proceed, but the bake needs later operator authorization.

### P0 — Superseded CL-6/CL-8/CL-9 remain implementable instructions

The vNEXT section says it supersedes CL-5 through CL-9 and specifies no runtime radius mutation or runtime bisector geometry ([lines 236–261](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:236)).

But the detailed CL text still says:

- Bake stored radii ×2.
- Retain a runtime neighbor-bisector clamp.
- “The bisector STAYS” in runtime dissolve.

([lines 338–361](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:338))

**Required correction:** label CL-6, CL-8, and CL-9 as historical and **DO NOT IMPLEMENT**, or rewrite them entirely to contain only the vNEXT definitions.

### P0 — Protected levels are both untouched and mutated

The same instruction says to leave the three levels untouched “during the run,” then edit them after step 4 lands ([lines 476–478](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:476)). Step 4 is part of the overnight run.

The three exact IDs are also absent.

**Required correction:** list the exact IDs and prohibit all writes tonight. Reclamation testing must be morning/manual-only or run exclusively against isolated copies whose results cannot be copied back.

### P0 — “Clear all hitboxes” has incompatible deletion semantics

CL-1 treats clearing as a batch geometry edit ([lines 313–316](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:313)). CL-3 says removing a hitbox deletes its canonical bird and cutout ([lines 407–413](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:407)). vNEXT says the hitbox is the bird’s stored position and tap radius ([lines 236–238](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:236)).

**Required correction:** explicitly choose whether Clear All bulk-deletes all birds or leaves bird identities in a geometry-missing blocking state. Until decided, CL-1 must not land.

### P1 — P2.1 uses lane selection invalidated by A3

P2.1 selects legacy behavior based on the absence of `.canonical` ([lines 70–73](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:70)). A3 requires authoritative state classification and fail-closed handling of partial/orphaned/quarantined states ([lines 524–528](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:524)).

**Required correction:** rewrite P2.1 to use the A3 state table and remove directory existence as a lane-selection rule.

### P1 — Projection deletion has three different gates

The document variously says:

- Inline/delete projection during P1.4 ([lines 48–49](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:48)).
- Kill it as Phase 1 exit ([lines 65–66](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:65)).
- Delete only after runtime and generation consumers convert ([lines 511–517](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:511)).
- Demote only after the later live shakedown ([lines 497–498](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:497)).

The failure ledger nevertheless calls deletion the Phase 1 closure proof ([lines 442–445](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:442)).

**Required correction:** prohibit projection deletion/demotion overnight. Steps 1–4 may convert consumers and reconcile the matrix, but removal remains gated on generation conversion plus the full later shakedown.

### P1 — Obligation edges depend on excluded job-store work

P1.7 is placed in step 2 ([lines 53–58](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:53)), while obligation edges require successor stages inside the same durable job and prevent commit until discharged ([lines 280–306](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:280)).

But durable attempts, guarded transitions, crash recovery, and magenta migration belong to P2c/step 5 ([lines 101–119](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:101), [line 495](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:495)).

**Required correction:** tonight’s DAG work is schema, derivation, staleness, pending-state persistence, and blocking gates only. Paid auto-run obligation execution remains deferred to P2c.

Also split formal edge types: a human hitbox move is called a non-auto-run staleness edge ([lines 293–294](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:293)), contradicting the definition that obligations are mandatory auto-run successors.

### P1 — R11 enforcement is simultaneously forbidden and required

The night decision says measure and propose only; enforcement waits for approval ([lines 479–481](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:479)). Yet:

- CL-2 enforces the minimum radius ([lines 317–319](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:317)).
- P2e.6 adds export/runtime enforcement ([lines 172–174](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:172)).
- Step 8 includes tolerances ([lines 499–500](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:499)).

**Required correction:** prohibit R11 enforcement tonight. Corpus measurement, proposed values, and non-enforcing diagnostics are the only permitted R11 outputs.

### P1 — The CL list unintentionally expands tonight’s scope

The entire CL list says “execute with the plan,” mostly inside step 4 or Phase 5, each with its own commit ([lines 308–311](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:308)). CL-3/P1.8 are then declared step 4’s highest-priority items ([lines 423–425](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:423)).

This can pull CL-1/2/4–18 into tonight.

**Required correction:** enumerate included CL work. For the requested scope, include only the CL-3 service/reconciliation contract and the CL-4 canonical-position consequence needed by steps 1–4. Explicitly defer the rest.

### P1 — Publication is required before its safety fixes land

The night decision requires regeneration and republishing of `uk_cotswolds_3a43` ([lines 482–484](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:482)). But the plan identifies current publication as stale-revision and non-transactional ([lines 563–568](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:563)); the repair is excluded step 6.

**Required correction:** stage and validate the regenerated package tonight, but do not republish or Start it unless a narrow safe publication transaction is separately brought into scope and proven. Production lineup mutation should remain prohibited.

### P1 — “No storage format changes” is false

The non-goal says the storage format stays unchanged ([lines 29–32](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:29)). The plan then adds serialized recipes, DAG/obligation state, human provenance, and geometry dependency provenance ([lines 123–158](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:123), [lines 262–305](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:262)).

**Required correction:** change this to “no replacement of the canonical revision-store architecture.” State that additive, versioned fields are allowed with backward-read defaults, CAS, preimage backup, journaling, and restore tests.

### P1 — Phase 3 has incompatible dispositions

P3.3 deletes `backfill_stable_ids.py` ([lines 181–187](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:181)). A4 says it is a recovery capability requiring an explicit retirement decision and parity fixtures ([lines 530–533](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:530)). Pre-execution verification recommends moving it to `attic/` with tests ([lines 627–632](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:627)).

**Required correction:** choose one disposition. This does not affect tonight because Phase 3 must be expressly prohibited.

### P2 — CL-16 correction has not propagated everywhere

CL-16 establishes level-scope review as the sole human assertion and removes operator-facing per-bird confirmation/counts ([lines 393–403](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:393)). Earlier text still refers to:

- A canonical “confirmation” write path ([lines 50–52](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:50)).
- Gallery confirmation counts ([lines 511–515](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:511)).

**Required correction:** replace “confirmation” with “level-scope review commit.” Define auto-stamped per-sprite records as invisible weak-label plumbing, and remove gallery confirmation-count conversion from A1.

### Other concrete inconsistencies

- P5.1 says “during this phase, not before,” but code/wire renames occur during Phases 1–2 ([lines 202–213](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:202)).
- The lifecycle state is `needs-review` in P2b but `review` later ([lines 89–92](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:89), [lines 611–614](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:611)).
- P1.6 is defined only retrospectively, while P1 jumps directly from P1.5 to P1.7 ([lines 50–53](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:50), [lines 554–561](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:554)).
- Robustification formally lists only R1–R4, while R5–R11 are later used as binding identifiers ([lines 219–231](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:219), [lines 578–619](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:578)).
- “Regression rule #11” has no matching rule in this document; it likely means AGENTS.md policy #11 ([lines 639–642](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:639)).
- CL-14’s “if hairy” escape hatch is non-deterministic and unsafe for unattended work ([lines 386–389](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:386)).
- Requiring every CL item to have its own commit conflicts with atomic cross-layer changes such as CL-3 plus P1.8 ([lines 308–311](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:308), [lines 407–425](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:407)). Require traceable acceptance entries, not necessarily one commit each.

## 2. Unattended-execution hazards

### Paid 50-run has no safety contract

The plan defines only a count and a dependency on the shakedown ([lines 136–143](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:136)). Missing:

- Exact 50 level/session IDs and source revisions.
- Provider/model and recipe revision.
- Seeds and variant selection.
- Output/staging location.
- Concurrency and provider-call caps.
- Maximum attempts and retry policy.
- Per-level and total USD caps.
- Wall-clock timeout.
- Stop-loss and reconciliation thresholds.
- Idempotency keys.
- Publish/lineup policy.
- Success/failure threshold.

This is especially unsafe because job-store double-spend defects are explicitly still open ([lines 457–461](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:457)).

**Rule:** the 50-run must not start without a checked-in immutable manifest and hard executable caps.

### CAS, backup, and restore rules are incomplete

R6 promises previews, snapshots, and restore ([lines 153–155](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:153)), but does not define:

- Snapshot location and retention.
- Content hash.
- Expected revision propagation.
- Atomic commit boundary.
- 409 handling.
- Restore command.
- Post-restore read-back.
- Whether automated retry is forbidden.

**Required invariant:** every mutation carries `expectedContentRevision`; a 409 is never blindly retried; a content-addressed preimage is written before mutation; one revision commits atomically; read-back is verified; a journaled restore is tested.

### Shared backend restart is unsafe

The plan directs a backend restart after each step ([lines 504–506](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:504)) without establishing process ownership, active-job drain, port isolation, or rollback.

The overnight run should use an isolated worktree, workspace, and backend port. It must not restart the shared editor/backend or Portal proxy.

### Destructive language lacks exact targets

“Delete the dead half,” P1.4 deletion, Phase 3 deletion, Phase 4 Portal deletion, and Phase 5 pruning appear throughout the same executable document ([lines 21–23](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:21), [lines 179–200](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:179)).

All deletion, pruning, migration, Portal, and projection-demotion work must be explicitly prohibited tonight.

## 3. Missing standalone definitions

Before execution, the document needs these repo-backed definitions:

1. **Protected-level manifest:** exact three IDs, starting revisions, and hashes.

2. **Fifty-run manifest:** exact 50 IDs, source revisions, recipe/variant/seeds, model, output root, expected counts, concurrency, retry/provider-call/USD/time caps, and abort rules.

3. **Minimal recipe schema:** owning module/schema path, version field, required/optional fields, enums/defaults, canonical serialization/hash rules, backward-read behavior, and UI/CLI parity tests.

4. **Writer inventory:** every geometry writer that must move behind the service. “All writers” is not an executable list.

5. **Consumer matrix baseline:** path to the checked-in matrix plus expected before/after counts.

6. **Mutation endpoint inventory:** needed to make “every mutation endpoint” verifiable.

7. **Exact verification commands:** the current `uv run pytest`, `tsc`, and generic smoke wording is not deterministic enough ([lines 504–507](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:504)).

8. **`uk_cotswolds_3a43` acceptance contract:** source revision, expected bird/artifact counts, recipe, maximum spend, staging target, obligation expectations, evidence paths, read-back assertions, and rollback.

9. **Standalone stress recipe:** the current recipe lives in “session scratchpad notes,” which will not survive compressed context ([lines 635–637](/Users/base/dev/appletolye/fabrikav2/docs/plans/2026-08-12-001-refactor-ftb-editor-canonical-first-simplification-plan.md:635)).

10. **Overnight definition of done:** item-level `DONE / AUTOMATED ONLY / PARTIAL / PARKED / NOT STARTED`, rather than a single overall completion claim.

## 4. Paste-ready Overnight goal brief

The placeholders marked `REQUIRED BEFORE RUN` must be filled with exact repo-backed values. Their absence is a hard no-start condition for paid work.

```markdown
## Overnight goal brief — sole execution authority

### Authority and stopping boundary

This section is the sole execution authority for the 2026-08-12 overnight run.
Where any phase text, amendment, operator change item, geometry discussion,
execution decision, or Order & estimates entry differs from this section, this
section wins.

The overnight run is limited to the allowlist below. “Never stop while
unblocked work remains” means continue through independent items on this
allowlist only. It does not authorize order steps 5–10 or any other phase,
CL item, cleanup, migration, publication, deployment, or refactor.

Use an isolated worktree, an isolated `LEVELBUILDER_WORKSPACE`, an isolated
`LEVELBUILDER_GAME_ROOT`, and an isolated backend port. Do not restart or
modify the shared editor backend, Portal proxy, production lineup, or active
operator workspace.

### Overnight allowlist and order

Execute only in this order:

1. Order step 1: canonical asset resolver and canonical-state classifier.
2. Order step 2: canonical hydration/read surfaces and DAG schema/state model.
3. Order step 3: revision-addressed read-back status and provenance.
4. Order step 4: CAS geometry mutation service, human-work authority, and the
   explicitly included CL-3/CL-4 behavior below.
5. Minimal recipe schema and UI/CLI resolution parity defined in this section.
6. One isolated `uk_cotswolds_3a43` CLI regeneration shakedown, only after its
   complete preflight gate passes.
7. One manifest-bound 50-level generation run, only after the shakedown passes
   and every paid-run gate below passes.

The overnight shakedown is not the full Order step 7. It does not prove P2b,
P2c, publication integrity, lifecycle, job-store crash recovery, or projection
removal.

### Item 1 — Asset resolver and state classifier

Done only when:

- One canonical asset resolver is used by candidates, readiness, asset serving,
  overlay, promotion, and export code reached by tonight’s scope.
- It verifies path containment, existence, nonzero/expected byte count, and
  SHA-256.
- Canonical lane selection uses `canonicalState`:
  - `VALID_CURRENT` requires canonical behavior.
  - `MIGRATION_REQUIRED` may use legacy only when the state contract explicitly
    establishes that no canonical artifacts exist.
  - `ORPHANED_STAGE`, `QUARANTINED_INTEGRITY`, and partial footprints fail
    closed.
- Tests cover valid, missing, replaced/hash-mismatched, escaping, empty, partial,
  orphaned, and quarantined assets/states.
- UI lane selection reads the authoritative state and does not infer it from
  directory existence or incidental revision/bird fields.

Not done if any named consumer retains an unclassified asset-resolution path.

### Item 2 — Hydration, reads, and DAG state

Done only when:

- `hydrate_session()` overlays canonical bird identity, current hitboxes,
  geometry, flips, and governed asset paths for `VALID_CURRENT` sessions.
- `sprite_animation_candidates`, readiness, candidate asset lookup, candidate
  overlay, candidate-by-id, and affected gallery reads use canonical state.
- Per-sprite review records remain invisible derived weak-label plumbing;
  level-scope “Mark cutouts reviewed” remains the only operator-facing cutout
  review assertion.
- `humanConfirmedBirds` and `reviewableBirds` are not retained as
  operator-facing gallery counts.
- The checked-in consumer matrix is reconciled against the repository and
  records before/after counts for every canonical-runtime, generation-input,
  legacy-authoring, migration, and export/evaluation consumer.
- The DAG schema represents dependencies, stale descendants, persistent pending
  state, and approval/export blocking.
- Tonight’s DAG implementation does not claim same-durable-job paid obligation
  execution. Paid automatic successor execution remains deferred to P2c.

Projection may remain in place. Item 2 is not done if projection deletion or
demotion is required to make its tests pass.

### Item 3 — Read-back and reconciliation

Done only when:

- Every mutation endpoint included in the checked-in mutation matrix performs a
  post-mutation refetch.
- The response/UI distinguishes at least:
  `persisted @ revision N`, `rendered from revision N`, stale export/build
  state, and rejection/unsaved state.
- Provenance reports revision, recipe/method/model when present, and
  level-scope approval state.
- A rejected geometry save discards or clearly isolates poisoned local IDs,
  restores server truth, and visibly marks any remaining local edits unsaved.
- Tests prove that a rejection does not leave minted/duplicate/unpersisted
  bird IDs rendered as persisted truth.
- P1.5 tests use the level-scope review commit, not a per-bird human
  confirmation concept.

### Item 4 — Geometry mutation service and human authority

Done only when:

- The plan contains and the implementation covers an explicit inventory of all
  geometry writers in tonight’s scope, including direct UI saves,
  auto-placement, recenter variants, VLM placement, magenta
  finalize/reconcile, `/select-bg`, add, remove, and move.
- Every listed canonical writer performs one revision-bound CAS mutation through
  the same service and performs no raw `hitboxes.json` or `session.json` write
  for `VALID_CURRENT`.
- Every request carries `expectedContentRevision`.
- A 409 is surfaced and refetched; it is never blindly retried.
- Before a destructive mutation, a content-addressed preimage snapshot and
  journal entry are written. The journal records source revision, requested
  change, affected artifacts/approvals, and restore command.
- The service commits one canonical revision atomically and verifies read-back.
- Byte-identical mutations are no-ops that preserve existing approvals.
- Human-origin geometry and approvals are preserved unless an explicit,
  itemized override is supplied.
- CL-3 contracts cover add, remove, move, save, rejection, and recovery:
  - add mints one stable canonical bird ID and marks missing descendants stale;
  - remove uses the canonical bird-delete operation and itemizes the affected
    cutout/artifacts;
  - move preserves identity;
  - rejection never poisons subsequent editing.
- CL-4 uses the current canonical hitbox as bird position; sprite anchor remains
  sprite-internal alignment data.
- `test_auto_placement_updates_canonical_geometry` and
  `test_identical_hitbox_save_preserves_review` become hard passing assertions.

CL-1 “Clear all,” CL-2 bulk radius changes, and CL-5 through CL-18 are not in
scope except for the exact CL-3 and CL-4 clauses above.

### Item 5 — Minimal recipe schema

This is a narrow schema/parity slice, not full P2d.

Before implementation, record:

- schema/module path: `REQUIRED BEFORE RUN`
- schema version: `REQUIRED BEFORE RUN`
- canonical default recipe path/hash: `REQUIRED BEFORE RUN`

Done only when:

- A versioned recipe schema defines the current default behavior without
  changing it.
- It includes, at minimum, existing prompt/model/dimensions/safe-area,
  placement, inpaint, cutout, export, variant-slot, difficulty-mix, bird-count,
  and paint-size fields needed to describe the existing lane.
- Every field has a required/optional rule, type, validation, and backward-read
  default.
- Serialization and hashing are deterministic.
- Old revisions without a recipe resolve to the recorded canonical default
  without rewriting those revisions.
- UI and CLI resolve byte-identical effective recipes from the same input.
- A dry-run command prints the resolved recipe and a semantic diff without
  writing state or starting provider work.
- Round-trip, backward-read, validation, deterministic-hash, and UI/CLI parity
  tests pass.

Not included tonight: experiment manifest/adopt-winner UI, cost-ledger UI,
golden-loop ingestion, R11 enforcement, radius migration, or full P2d/P2e.

### Protected levels

These source levels must remain bit-for-bit and revision-for-revision unchanged:

- `REQUIRED BEFORE RUN: exact level/session ID 1`
- `REQUIRED BEFORE RUN: exact level/session ID 2`
- `REQUIRED BEFORE RUN: exact level/session ID 3`

Before any work, record each source revision and a content hash over its
canonical store and governed assets. At the end, recompute and compare them.

Prohibited against these source levels tonight:

- edits, saves, review actions, regeneration, import, migration, restore,
  republish, lineup changes, fixture writes, or automated “repair”;
- any read path known to normalize, migrate, project, or otherwise write;
- copying test results or modified clones back into the source sessions.

If reclamation behavior must be tested automatically, use isolated copies in
the throwaway workspace. Source-level reclamation proof is morning/manual-only.

### `uk_cotswolds_3a43` shakedown gate

Before starting a provider call, freeze and record:

- source session/level ID and canonical revision;
- source canonical/assets hash;
- exact resolved recipe JSON, version, and hash;
- provider/model and seed;
- expected bird/stage/artifact counts;
- command and isolated output root;
- idempotency key;
- maximum attempts: 1;
- maximum concurrent paid jobs: `REQUIRED BEFORE RUN`;
- provider-call cap: `REQUIRED BEFORE RUN`;
- USD cap: `REQUIRED BEFORE RUN`;
- wall-clock timeout: `REQUIRED BEFORE RUN`;
- immutable preimage/package backup and tested restore command.

Do not start if the cost meter is unavailable, the worst-case estimate exceeds
the cap, the source revision changed, the output root is not isolated, or any
required value above is missing.

The shakedown passes only when:

- the CLI uses the frozen effective recipe;
- exactly the expected stages/items reach reconciled terminal states;
- no item is silently missing or duplicated;
- canonical read-back reports the expected new revision;
- resolver integrity checks pass for every governed artifact;
- pending obligations and deferred paid obligations are reported truthfully;
- contact sheet/full scene/overlay/all-picked-up/representative pickup evidence
  is generated and its paths and hashes are recorded;
- measured cost and duration remain within caps;
- no protected level or production lineup is modified.

Stage the regenerated package for inspection. Do not republish, activate,
Start, or replace the production catalog package tonight. Publication remains
blocked until P2b transactional/revision-bound publication integrity lands or
the operator grants separate explicit authorization.

A failed shakedown is not retried automatically.

### Gated 50-level run

The 50-run must not start until the shakedown has passed and a checked-in,
immutable run manifest exists at:

`REQUIRED BEFORE RUN: manifest path and SHA-256`

The manifest must contain exactly 50 unique source entries and pin, per entry:

- level/session ID and source canonical revision;
- resolved recipe version/hash and variant;
- provider/model and seed;
- expected bird/stage/item counts;
- isolated output path and idempotency key.

It must also define:

- maximum concurrency: `REQUIRED BEFORE RUN`;
- maximum attempts per paid operation: 1;
- total provider-call cap: `REQUIRED BEFORE RUN`;
- per-level USD cap: `REQUIRED BEFORE RUN`;
- total USD cap: `REQUIRED BEFORE RUN`;
- wall-clock deadline: `REQUIRED BEFORE RUN`;
- abort thresholds for integrity, CAS, count-reconciliation, provider, and
  cost-meter failures;
- no-publish/no-lineup default.

Preflight must validate the 50 unique entries, source revisions, recipe hashes,
output isolation, expected counts, idempotency keys, meter availability, and
worst-case spend. Do not start if any check fails.

The run is done only when all 50 entries have a reconciled terminal record.
Failures may remain failures; they must be itemized. “Done” means no missing,
duplicated, ambiguous, or still-running entries and spend within cap—not
necessarily 50 successful generations.

Abort the remaining queue immediately on:

- missing cost metering or breached/projected-to-breach cap;
- integrity or path-containment failure;
- source-revision/CAS mismatch;
- duplicate or unaccounted provider call;
- count-reconciliation mismatch;
- evidence written outside the isolated output root.

Never automatically retry, recover, or repurchase a failed/orphaned paid unit
while P2c remains deferred.

### Verification contract

Before implementation, replace every `REQUIRED BEFORE RUN` below with an exact
repo-valid command. A missing command parks the affected item; it does not
authorize an improvised broader suite.

Required evidence categories:

1. Repository orientation:
   - base SHA, branch/worktree path, initial dirty status;
   - isolated workspace/root/port and process ownership.

2. Code health:
   - exact Python test command/selectors: `REQUIRED BEFORE RUN`;
   - exact TypeScript typecheck command: `REQUIRED BEFORE RUN`;
   - exact lint command scoped to changed files/package:
     `REQUIRED BEFORE RUN`.

3. Contract tests:
   - resolver/state-classifier tests;
   - hydration/read-surface and consumer-matrix tests;
   - mutation read-back/rejected-save reconciliation tests;
   - CAS/no-blind-retry/preimage/restore tests;
   - add/remove/move and human-authority tests;
   - recipe round-trip/backward-read/hash/parity tests;
   - named `tests/test_plan_contracts.py` xfails flipped only when their
     corresponding behavior lands.

4. Live isolated API verification:
   - start command and health/readiness check: `REQUIRED BEFORE RUN`;
   - exact commit/config/read-back assertion;
   - no shared backend restart.

5. Paid/live evidence:
   - shakedown command, job ID, source/result revisions, recipe hash, cost,
     duration, terminal counts, artifact hashes, and evidence paths;
   - 50-run manifest hash, terminal reconciliation, failures, provider-call
     count, cost, duration, and output paths.

Report each item separately as:

- `PASS`: the requested real behavior was directly observed.
- `AUTOMATED ONLY`: tests passed but live behavior was not observed.
- `PARTIAL`: some definition-of-done clauses passed.
- `PARKED`: a recorded blocker prevents safe continuation.
- `NOT STARTED`: its gate never opened.

Do not convert `AUTOMATED ONLY` into `PASS`.

### Hard prohibitions

Tonight, do not:

- implement P2b, P2c, Phase 3, Phase 4, or Phase 5;
- implement order steps 5–10;
- delete, inline, or demote `project_canonical_bird_compatibility`;
- delete or move migration/recovery code;
- bake or rewrite stored radii;
- remove/change runtime tap multipliers or arbitration;
- enforce R11 values in authoring, export, runtime config, or gameplay;
- change tap behavior anywhere;
- implement CL-1, CL-2, or CL-5 through CL-18 except the explicit CL-4
  canonical-read consequence above;
- mutate the three protected source levels;
- mutate a production lineup, publish/republish, activate, or Start;
- run corpus-wide migration, normalization, repair, or cleanup;
- add dependencies;
- touch the Portal repo/process or shared backend;
- deploy, merge to main, force-push, delete a branch, or perform destructive Git
  operations;
- start a paid call without its frozen manifest, idempotency key, meter, caps,
  backup, and abort rules;
- weaken a gate, convert a hard failure to a warning, or remove/xfail a test to
  continue.

Measurement-only R11 reports and radius-equivalence test-harness work are
allowed, but they may not write corpus/runtime/config data or become gates.

### Park-and-continue blocker protocol

When an allowlisted item becomes blocked:

1. Stop work on that item before any unsafe mutation or paid retry.
2. Roll back or isolate incomplete external mutation where the recorded restore
   procedure safely permits it; never improvise destructive recovery.
3. Record:
   - item and status;
   - base/current SHA and dirty files;
   - exact command/action and complete error;
   - source revision, recipe hash, job/provider IDs, and output paths;
   - safe diagnostic checks attempted;
   - money/provider calls already incurred;
   - preserved backup and restore point;
   - suspected cause and smallest next action requiring human input.
4. Mark only that item `PARKED`.
5. Continue independent items remaining on this overnight allowlist.
6. Do not bypass the blocker by widening scope, weakening assertions, changing
   production data, retrying paid work, or starting a dependent item whose gate
   did not pass.

A dependency-blocked downstream item is `NOT STARTED` or `PARKED`; it is not
silently skipped and is never reported complete.

### Morning deliverable

Write one standalone report containing:

1. Executive table:
   `Item | Status | Commit(s) | Verification | Live evidence | Blocker`.
2. Starting base SHA, ending HEAD SHA, branch/worktree, and final dirty status.
3. Commits and changed files grouped by overnight item.
4. Exact commands executed, exit codes, pass/fail/skip/xfail counts, and logs.
5. Definition-of-done checklist for every item, with unmet clauses explicit.
6. Consumer and mutation matrix before/after counts.
7. Existing xfails that remain and the exact xfails converted to hard passing
   assertions.
8. `uk_cotswolds_3a43` ledger:
   source/result revisions, recipe and manifest hashes, command, job/provider
   IDs, expected/actual counts, cost, duration, artifact hashes, evidence paths,
   staging result, backup, and rollback point.
9. Fifty-run ledger:
   manifest path/hash, 50 terminal records, success/failure counts, itemized
   failures, missing/duplicate reconciliation, provider-call count, cost versus
   cap, duration, and output/evidence paths.
10. Protected-level proof:
    exact three IDs plus before/after revisions and hashes demonstrating no
    source mutation.
11. Hard-prohibition attestation listing each prohibited category and confirming
    whether it remained untouched.
12. Blockers and parked work, including safe next actions.
13. Rollback instructions for every committed schema/data/external change.
14. Explicitly unverified behavior.
15. Recommended next actions, without executing them.

The overall overnight result must not be called complete unless every
allowlisted item is `PASS`. Otherwise report the per-item statuses truthfully.
```

The most important no-start conditions are the three protected IDs, the immutable 50-run manifest, hard paid-work caps, exact verification commands, and the decision to stage rather than republish `uk_cotswolds_3a43`.