# FTB Editor: Canonical-First Simplification & Robustification Plan

**Date:** 2026-08-12 · **Status:** PROPOSED, amended per codex review (verdict: proceed with
amendments — `docs/reports/2026-08-12-ftb-editor-codex-review/`) · **Prereq reading:** today's
incident chain (commits `924439a26..15402b1af`)

## Why now

One day of real editing on canonical sessions surfaced six defects with a single root cause:
the canonical store became the write-side truth while every read surface (sprite candidates,
review readiness, the asset endpoint, recenter, exports of intermediate state) still consumes
the legacy compatibility files (`dogs/<slot>/sprite_XXX.{png,json}`, `hitboxes.json`,
`session.json` dogs). The seams are stitched by hand-written projections; every unstitched
seam is a future "it said saved but nothing changed."

Secondary root causes, same family: two deploy surfaces (API process vs `ui/dist`), and two
addressing schemes (stable bird id vs positional slot index) used interchangeably.

## Goals

1. **One truth for reads.** A canonical session is read through its snapshot, full stop.
2. **Delete, don't maintain, the dead half.** Legacy lanes exist only where a legacy corpus
   still needs them, behind one explicit boundary.
3. **Every "saved" is observable.** No write path may return success unless the surface the
   editor re-reads reflects it.
4. **Single deploy surface.** A restart ships the current editor, by construction (guard
   already landed; finish the job by removing the second copy).

## Non-goals

- No storage format changes; the canonical revision store stays as-is.
- No speculative features. The only additions are invariants and the operator-loop items
  mined from the conversation corpus (Phases 2b–2e) — each traces to a dated operator
  correction, not to taste.
- find_the_dog corpus migration is out of scope (Phase 3 gates on it).

## Phase 1 — Canonical-first reads (the payoff phase)

**P1.1** `sprite_animation_candidates`: when the session is `VALID_CURRENT`, build candidates
from the snapshot (geometry, image path, flips, confirmation from `candidateReviews`), using
sidecars only for fields canonical does not govern (quality diagnostics, regeneration review).
Non-canonical sessions keep the sidecar path unchanged.
**P1.2** `get_final_cutout_review_readiness`: for canonical sessions, readiness = snapshot
completeness (every bird has a sprite asset on disk). Delete the sidecar-walk for that branch.
**P1.3** `sprite_candidate_asset` endpoint: resolve through the snapshot's asset path first
(job-artifacts included), sidecar path as fallback.
**P1.4** Demote `project_canonical_bird_compatibility` to exactly what still needs it after
P1.1–P1.3 (target: export lane and nothing else), then inline or delete it.
**P1.5** Regression: a test that commits via every canonical write path (geometry, promote
with scene, confirmation) and asserts the *API responses* (not files) reflect the commit —
the phantom-save class, pinned at the contract level.
**P1.7 — Artifact DAG as the Phase 1 data model** (mining #2). Encode the dependency graph
explicitly: background → painted scene → hitboxes → padded crops → cutouts → export. Each
canonical commit marks only descendants stale; a `regenerate` action previews affected
artifacts + approvals + cost before running and executes only stale nodes. Retires "delete
whole level" and rebinding as recovery rituals. ("What step do we need to regenerate?" 08-12,
"This wont require a regeneration of sprites right?" 08-07.)
**P1.8 — Read-back truthful status** (mining #3). Replace generic "saved" with read-back
states — `persisted @ revision N`, `rendered from revision N`, `export stale`, `in build X` —
rendered from a post-mutation refetch, never from request completion. A provenance strip
(revision, method/model, approval state) on every level view. ("It says extraction saved but
I see the old version" 08-12.)

Exit criteria: kill the projection sweep; `grep -c project_canonical_bird_compatibility` ≤ 2;
phantom-save test green; every mutation endpoint's response consumed via read-back state.

## Phase 2 — One generation lane

**P2.1** `_start_retry_failed_dogs_job_record`: require canonical (`birdIds` +
`expectedContentRevision`) when the session has a canonical store; the legacy
`dogIndices`/blessed-hitboxes branch survives only for sessions with no `.canonical` dir,
and logs loudly when taken.
**P2.2** UI `runCandidate`: drop the legacy request shape for canonical candidates (it exists
today only as a fallback that immediately 409s and retries — send canonical or fail).
**P2.3** Delete the `hitboxesSha256` staleness plumbing from the canonical path (provenance
verification already covers it; two gates, one meaning).

## Phase 2b — Publication integrity (gallery review F-B)

**P2b.1** Catalog entries are revision-bound: publish stamps the reviewed authoring
`contentRevision` + package identity; sequence validation and Start refuse a catalog entry
whose revision ≠ the currently reviewed one; Gallery shows "Republish" when they differ.
**P2b.2** Transactional Start: build the complete bundle/index candidate in memory against
the exact validated draft revision, activate, then commit atomically; failure leaves disk
untouched.
**P2b.3** No blind CAS-retry on human approvals: a 409 on hitbox/final-cutout approval
reloads the level and requires a fresh human click (same class as today's review-click loss).
**P2b.4 — Lifecycle state machine** (mining #8): replace independent flags with
`draft → needs-review → approved → lineup → published`, plus `archived`; archiving atomically
un-lineups whole sessions only (never a sibling variant); builds consume a named immutable
lineup snapshot; one reconciliation panel shows counts and any illegal combination.
("archive should automatically unline up" 08-07; "Catalog levels not in the lineup what are
these" 08-07.)
**P2b.5 — Retire sprite-only compositing** from wizard/gallery/publish surfaces (mining
#10); keep the guard test; archive the lane's code path behind an explicit experiment flag.

Exit: publish/Start cannot ship a revision that differs from the reviewed one (contract
test); archived⇒not-in-lineup enforced by state machine, not convention.

## Phase 2c — Job-store hardening (jobs review F-C)

**P2c.1** Attempt generations + explicit transition graph in `transition_job`; every
execution transition carries expected status/owner/attempt; stale attempts cannot finalize.
**P2c.2** Requeue retains succeeded children and their results; only failed/unresolved units
re-execute (generalize the failed-bird lane's model; flips the
`test_background_retry_retains_succeeded_children` xfail).
**P2c.3** Requeue refuses non-terminal jobs (flips `test_requeue_refuses_running_jobs`).
**P2c.4** Owner-aware crash recovery reruns after startup (no permanently `running` jobs);
provider-timeout attempts that cannot be cancelled become `orphaned_unknown`, never retried
into double spend; one-active-paid-job per (session, bird, operation) guard.
**P2c.5** Magenta inpaint moves onto the durable job store + resume layer; SSE lanes emit a
canonical terminal event; UI reconciliation derives success only from `job.status`.
**P2c.6 — Batch count reconciliation** (mining addendum B): every batch job declares
expected counts, reconciles at completion, hard-fails with an itemized diff on mismatch.
("the math doesnt check out. we had 30 you spent 15 and now we have 10" 08-06.)

Exit: both job-store xfails flipped; kill -9 during a batch leaves no stuck jobs and no
double-billable state; a deliberately short batch fails loudly.

## Phase 2d — Canonical recipe & experiment manifest (mining #7, #9)

**P2d.1** One versioned `recipe` object (prompt templates, model, dimensions, safe areas,
placement, inpaint, cutout, export settings) serialized with every level revision; UI and
CLI call the same operations with the same recipe. Dry-run recipe diff.
**P2d.2** Experiment manifest: every candidate level carries a human label, recipe revision,
seed, model, source revision, measured cost, duration, artifact hashes. Standard contact-
sheet comparison view; "adopt winner as canonical" action. Retires tag-as-provenance
(`poststretch`, `deepdive`). ("write the name of the model to the level" 08-05; "for the
love of god please write what I am looking at" 08-05.)
**P2d.3 — Cost ledger** (mining addendum A): $/stage measured from the merceka ledger on
every revision and gallery card; recipe changes show projected Δ$/1000 levels. Never
estimated when a meter exists.
**P2d.4** Tests ban dog-specific copy/config inside bird recipes; experiment overrides live
behind an explicit experiment mode that cannot silently become production.

## Phase 2e — Human-work authority (mining #1, #5)

**P2e.1 — R7, the class fix:** human-placed/edited geometry (hitboxes, padding, placements)
and approvals carry provenance (`human:` origin) in the canonical snapshot; every automated
lane (auto-place, recenter, magenta reconcile, import, repair) refuses to modify
human-origin geometry without an explicit `--override-human` consent, listing exactly what
it would change. ("Did we lose all my hitbox cleanup work?" 08-07; "the 17 hitbox review I
made disappeared" 08-12.)
**P2e.2 — R6 impact plan:** destructive operations (regenerate, rebind, migrate, import)
print/preview: preserved edits, invalidated edits + why, artifacts regenerated, projected
cost — before executing; auto-snapshot before, one-click diff/restore after.
**P2e.3** Byte-identical saves are no-ops that preserve approvals (flips
`test_identical_hitbox_save_preserves_review`); `restore_verified_*` promotion wired into
migration apply so representation-only changes self-heal approvals.
**P2e.4 — Golden loop** (mining #5): machine-before/human-after geometry pairs are recorded
automatically on every human correction, feeding the eval set that calibrates placement —
the operator's corrections become training data without a separate "make golden" ritual.
**P2e.5 — R8 visual evidence:** every generation/regeneration run emits a contact sheet
(full level, overlays, all-picked-up reconstruction, representative pickups) with
image-load and registration/dimension assertions; promotion blocks on missing or broken
evidence. ("your report shows no images" 08-03.)
**P2e.6 — R11 tolerance invariants:** minimum tap radius, 2× tap acceptance, hitbox size
uniformity band, hint-on-screen, no-wrap-after-last-level — versioned numbers in the recipe,
asserted by the export gate and runtime-config tests so regeneration can never regress them.

Exit: an automated lane attempting to move a human-placed hitbox without consent is a test
failure; a regeneration run without a contact sheet cannot promote.

## Phase 3 — Shrink the migration machinery (~1,400 lines)

**Gate:** confirm the find_the_dog corpus is either already canonical or explicitly frozen.
**P3.1** Extract `_stable_uuid` + `_public_dog_id` into a small `stable_ids.py` (the only
live imports from `canonical_migration` besides the audit classifier).
**P3.2** Fold the audit's legacy-identity classifier into `integrity_audit.py` (read-only
evidence needs ~80 of `backfill_stable_ids`'s 296 lines).
**P3.3** Delete `canonical_migration.py` and `backfill_stable_ids.py`; `corpus_migration.py`
is the one migration engine (it already handles plan/apply/journal/quarantine/refresh/import).

## Phase 4 — One deploy surface

**P4.1** Backend mounts `ui/dist` (static + index) behind the existing port; portal's
`/tools/ftd-editor` becomes a pure reverse proxy (it already proxies `/api`).
**P4.2** Delete the portal's static-file serving of the editor and its cache workarounds.
**P4.3** Keep the launch-time build guard; add the dist content hash to `/api/config` so a
mismatched UI is detectable in one request.

## Phase 5 — Surface pruning (mechanical)

Dead editorApi exports (15), the always-410 `DELETE /catalog/levels/{id}` stub, knip-confirmed
UI files as they fall out of Phases 1–2, duplicate `checksum_tree`.

**P5.1 — Dog→entity verbiage (operator request 2026-08-12, recurring since 2026-08-04).**
Three tiers, executed during this phase, not before:
- *User-visible strings* (UI labels, tooltips, aria, API error messages): dynamic
  `session.entity` where component context has it (the `entityPlural` plumbing already
  exists), neutral "entity" elsewhere. A prepared diff was reverted on 2026-08-12 pending the
  migration — the mechanical recipe: `candidateLabel(candidate, noun)` threading in
  CutoutReviewPanel/AnimationLibraryPage/SpriteAnimationWizard, DogStrip/DogRegenList labels,
  GalleryReviewModal "{n} dogs", backend `"error": f"Dog {i}…"` strings; pin the panel
  harness to `entity="dog"` so smoke strings survive.
- *Code identifiers and wire fields* (`nDogs`, `dogIndices`, `dogPrompt`, `DogsCanvas`…):
  rename as each surface is converted in Phases 1–2 (wire fields only at the Phase 2 lane
  boundary, with the UI updated in the same commit).
- *On-disk formats stay frozen*: `dogs/dog_NN` slots, `session.json` dogs[], and the shipped
  `level.json` dogs[] contract are compatibility surfaces the game runtime reads — renaming
  them breaks every existing level and package for zero player value. Document as
  "compatibility naming" in CONTEXT.md instead.

## Robustification (cross-cutting, lands with each phase)

- **R1. Slot vs id lint:** one helper for hitbox↔dog binding (by id, positional fallback
  with a logged warning); ban raw `hitboxes[index]` / `dog_{i:02d}`-from-enumerate patterns
  by convention note and a grep-based test.
- **R2. Fail loud on unpersistable writes:** any endpoint that cannot persist (missing
  session, package-only level) returns an error — never `{ok: true}`. The archive and
  hitbox-review silent no-ops were both this bug.
- **R3. Live shakedown protocol:** any new integration seam ships with one recorded live run
  (project rule already; the canonical regen scene-commit lane still owes its first live run).
- **R4. Review-preservation tests** stay mandatory for every representation change
  (policy #11; the promotion sweep exists — wire `restore_verified_*` into migration apply
  so over-invalidation self-heals instead of needing an operator).

## Geometry model vNEXT — stress-tested (simulator over 64 real levels × 3 pickup orders
## incl. adversarial; codex adversarial spec review; both archived in the reports dir)

Final definitions (supersede any looser phrasing in CL-5..CL-9):
1. **Hitbox** = stored center + authored tap radius. Runtime does only circle membership +
   deterministic nearest-center arbitration. Nothing at runtime mutates a radius.
2. **Restore source** = the quality-gated paint-diff (scene − clean bg), never sprite
   bounds. Diff gate: perceptual threshold, low-frequency tint removal, tiny-component
   scrub, and a fail-closed "needs restoration review" when the footprint is globally
   distributed (measured: 749k px unassigned junk on 3 drifted levels — the gate doubles
   as a repaint-drift detector).
3. **Restore ownership** = a complete per-pixel partition of the accepted diff: components
   split across the global Voronoi partition (deterministic, stable-id ordered) before
   assignment — components are never the indivisible ownership unit. Set-level derivation
   with a full dependency hash (scene, clean bg, complete hitbox set, sprite geometry,
   recipe); any input change stales the whole partition.
4. **Dissolve** (validated: premature-erasure = 0 px corpus-wide, worst-case order):
   `reveal = union over FOUND birds of (their region − union(still-unfound birds'
   OWNED-paint mask ∪ sprite alpha mask))`, recomputed on every pickup (progressive
   re-dissolve — protections only shrink; closes the 63k px stranded-residue hole the
   first simulation found). Voronoi survives only as the assignment rule; no runtime
   bisector geometry.
5. **Tap-radius migration** (corrects CL-6/CL-8's "×2 bake"): bake each bird's RESOLVED
   legacy effective radius (full formula: floor, square vs non-square multiplier, neighbor
   clamp, original neighbor set) — not raw×2. Migration gate: dense tap-point grid,
   legacy winner == migrated winner everywhere. Radii live in a narrow uniformity band
   with a derived recommended radius per bird; outliers flagged for an explicit decision,
   never silently multiplied. Body-coverage invariant: required % of core body mask
   inside the circle.
6. **Manual overrides** carry dependency provenance and go `STALE_MANUAL` on any input
   change — bytes preserved, publish blocked until re-derive / reconfirm / re-edit.
   Tie-band pixels (equidistant props) get a deterministic primary owner + all tied birds
   as protectors, or are flagged for review.

Simulator invariants (export-gate suite; prototype checked in at
`tools/level-editor/scripts/geometry_model_sim.py`, final metrics in the reports dir):
complete-cleanup + permutation convergence; unfound-bird preservation; ownership
conservation (union == accepted diff, exclusive owners disjoint); tap-migration
equivalence + body coverage; determinism + provenance freshness.

## Obligation edges — the workflow contract (operator principle, 2026-08-12)

("We have a CLI for a reason… after every magenta inpainting we automatically need to
ensure the boxes are centered… whenever we regenerate we need to explicitly understand
where the hitbox is… we don't want to wave away any step, and we need tests and mechanisms
to ensure that doesn't happen.")

The DAG (P1.7) gains **obligation semantics**: some edges are not staleness markers but
mandatory auto-run successors, executed inside the same durable job as the operation that
triggered them. An operation has not COMMITTED until its obligations are discharged; a
level cannot reach `approved` while any obligation is pending; the export gate refuses
artifacts whose obligation chain is incomplete (recorded in provenance: which steps ran,
with which recipe revision).

Initial obligation table (extends as steps are added — the table IS the workflow):
- **magenta paint / repaint** → hitbox re-localization (Gemini snap / local-diff recenter
  per recipe) → restore-partition re-derivation → diff quality gate.
- **regenerate(bird)** → localize that bird's hitbox against the new paint → re-extract
  its cutout → sprite placement + anchor recompute → restore-partition update.
- **extract(bird)** → sprite placement + anchor recompute → restore-partition update.
- **hitbox move (human)** → restore-partition re-derivation (staleness edge, not auto-run:
  human geometry is authority, derivation follows it).
- **any scene commit** → contact-sheet evidence artifact (R8) + count reconciliation (R10).

Enforcement mechanisms, all three required:
1. **Structural:** obligations run as stages of the triggering job — there is no API
   through which a lane can perform the parent step without them (UI and CLI share the
   same operation, P2d.1 parity).
2. **Stateful:** unmet obligations are visible level state (`obligation-pending: …`),
   blocking approval — never a silent gap discovered by eyeballing hitboxes.
3. **Tested:** one contract test per obligation edge asserting that (a) the happy path
   discharges it, (b) an artificially interrupted job leaves the pending marker, (c) the
   export gate refuses the incomplete chain. New pipeline steps must ship their obligation
   row + test in the same commit — a step without a row in the table does not exist.

## Operator change list (dictated during the 2026-08-12 four-level review pass)

Small, concrete editor changes requested while reviewing; execute with the plan (most land
naturally inside step 4's geometry service or Phase 5), each with its own commit.

- **CL-1. "Clear all hitboxes" button** in the hitbox editing surface (placement view +
  review modal). Goes through the canonical geometry service (one CAS commit, review
  invalidation, impact preview per R6 — clearing N human-placed hitboxes is exactly the
  operation that must show what it destroys before doing it).
- **CL-2. Grow/shrink all hitboxes** — two buttons scaling every hitbox radius by a step
  (±10%, min-tap-radius floor from R11 enforced, live overlay preview). One CAS commit for
  the batch, not N; respects the uniformity band once R11 lands.
- **CL-4. Cutout view must follow the current hitboxes** (fairy_ring_9ed2, 2026-08-12:
  operator re-placed + confirmed hitboxes; cutout panel ignored them). `candidateTarget`
  prefers the sprite sidecar's anchor over the live hitbox, so padding defaults, drag
  clamps, and the Show-hitbox circle all track stale anchors after a manual hitbox pass.
  Fix with P1 canonical-first reads: one authoritative bird position (current hitbox),
  anchor demoted to a sprite-internal alignment detail; the Show-hitbox overlay must render
  the actual hitbox, never a derived target. DAG (P1.7) marks crops/cutouts stale when
  hitboxes move, which is what "doesn't respect it" actually is.
- **CL-5. Geometry model: one truth + deriveds** (operator discussion 2026-08-12 evening,
  becomes step 4's data model). Hitbox = the bird's position AND its real tap radius.
  Generation crop: derived, never stored. Restore region (rename of cleanupBox): derived
  from the PAINT-DIFF footprint (scene − clean bg, components Voronoi-assigned to the
  nearest bird) — NOT sprite bounds: verified on healthy levels that 45-60% of a bird's
  painted pixels can lie outside its sprite (cheese_farm dog_19: the water bucket the bird
  drinks from; france_mont dog_16 — evidence measured 2026-08-12). Manual override
  flagged; DAG re-derives on hitbox/sprite/scene moves. Sprite keeps box + flips; anchor becomes recomputed,
  never a stored competing position. Kills cleanup_misses_hitbox, stale-anchor drift, and
  the padding-name collision as classes.
- **CL-6. Tap truth: kill the in-game 2× leniency multiplier.** One-time data bake
  (stored radii ×2, clamped to R11 floor/ceiling), remove the runtime multiplier; editor
  circle = actual tap area. Magenta paint-dot radius moves to the canonical recipe as a
  generation parameter — paint size and tap size get separate honest owners.
- **CL-7. Remove the map's padded-crop preview under the magenta default** — it previews a
  crop the canonical lane never sends; show only when the crop lane is explicitly active.
- **CL-8. Collapse the tap-radius stack** (extends CL-6; verified in
  `hitboxGeometry.resolveRuntimeHitRadius` + `findClosestUnfoundDogInSet`). Stored r
  becomes the tap radius: bake the tolerance multiplier and minimum floor into the data
  once (floor moves to authoring via R11); runtime keeps only the arbitration rules —
  nearest-center-wins and the neighbor bisector clamp. Overlapping hitboxes become legal:
  placement stops shrinking/nudging close pairs, editor overlap warning becomes
  informational. Editor circle = what actually taps.
- **CL-9. Composed dissolve rule (operator formulation, 2026-08-12).** Pickup dissolve:
  `dissolve(A) = restoreRegion(A) ∩ A's Voronoi half-spaces − union(sprite footprint of
  every still-unfound neighbor)`. The bisector STAYS — it protects neighbors' unlabeled
  painted props (bucket/flower spill, measured at 45-60% of paint outside sprite bounds);
  the sprite-footprint subtraction adds protection for neighbor body pixels that cross
  the line. Compose, never replace. Converges to a fully clean scene
  because each bird's own dissolve covers the area neighbors spared. Kills the
  leftover-sliver artifact; runtime already ships sprite boxes + masks, no new data.
  Hitbox and restore region stay distinct on purpose: hitbox = tap truth, restore
  region = derived from the accepted paint-diff (CL-5 is authoritative; an earlier
  sprite-bounds phrasing here contradicted it — codex adversarial review caught it).
  With CL-5 this removes "cleanup" as an operator-managed concept entirely.
- **CL-10. Instant scene views.** Painted / Clean / All-picked-up / Sprites-only become
  pre-rendered, revision-addressed webp previews generated once per scene commit (they ARE
  the R8 evidence artifacts), served statically; toggling is an img swap. Preview carries
  its revision hash — stale is detectable, never silent. Kills the per-click full-res
  server composite.
- **CL-11. Residue gate + heatmap.** `residue = perceptual-diff(all-picked-up, clean bg)`
  computed in the same scene-commit obligation, using the RUNTIME composite rules (the
  derivation-vs-runtime handshake). Surfaces: export gate (blocks approval above
  threshold — the 08-06 "padded areas should be larger" incident as an invariant),
  gallery card badge (residue px), and a fifth modal toggle rendering residue pixels as a
  heatmap. Under the vNEXT geometry model residue is ~0 by construction, so the gate's
  standing job is catching stale overrides, drifted data, and derivation/runtime
  disagreement.
- **CL-3. Hitbox add/remove must be legal or impossible** (italy_tuscan archived over this,
  2026-08-12: "canonical hitbox identity set does not match the current revision"). The
  editor offers add-by-click / remove-by-double-click, but the canonical `/hitboxes` save
  rejects any identity-set change — only moves are persistable. Fix inside step 4's geometry
  service: adding a hitbox creates a canonical bird (minted id, no sprite yet, DAG marks
  cutout stale), removing one deletes the bird via the existing delete operation with an R6
  impact preview ("removes bird + its cutout"). Until then the affordance is a trap that
  hard-blocks levels and reads as "level broken". Same family as the removed padded-box
  block: surfaces must not invite actions their write path forbids. Second occurrence same
  day (fairy_ring_9ed2): the rejected save left the canvas showing the operator's local
  hitboxes as if persisted — discovered only when the cutout view disagreed. A rejected
  geometry save must visibly mark the canvas dirty/unsaved and re-show server truth
  (P1.8 read-back + R2), never keep rendering unpersisted edits as reality. Third
  escalation same session: after one rejected save the modal's local hitbox array stays
  poisoned (minted/duplicate ids), so even pure MOVES fail thereafter ("canonical hitboxes
  require unique birdId values") — one rejection breaks all hitbox editing for that level
  until reload. The 2026-08-12 review pass STOPPED on this; the operator's remaining three
  levels are presumed blocked by the same class. CL-3 + P1.8 reconciliation are therefore
  the highest-priority items of step 4.

## Failure-class closure ledger (2026-08-12's six classes → closing step → proof)

Every class observed on 2026-08-12, the step that closes it structurally (not patches it),
and the artifact that PROVES closure. A class is closed when its proof exists, not before.

1. **Stale UI build** ("you were on yesterday's editor all day").
   Patched: launch-time rebuild guard (31eb1084c). Closed by: Phase 4 single deploy
   surface. Proof: dist content hash in /api/config matches served index on every start;
   the portal serves nothing itself.
2. **Legacy writers clobbering canonical state** (sticker recomposite; wizard auto-place /
   recenter / select-bg divergence). Patched: sticker default off, canonical sessions skip
   legacy recomposite (1c62879a6). Closed by: step 4 geometry mutation service (P1.6) —
   zero direct writes to hitboxes.json/session.json on VALID_CURRENT sessions. Proof:
   grep-level test banning `save_hitboxes`/raw writes outside the service;
   `test_auto_placement_updates_canonical_geometry` xfail flips.
3. **Phantom saves** ("extraction saved but I see the old version"). Patched: projection
   layer + sweep (6eb77d7d2). Closed by: Phase 1 canonical-first reads + P1.8 read-back.
   Proof: P1.5 contract test (API responses reflect every canonical commit);
   projection function deleted (P1.4 exit criterion).
4. **Blocked edits + poisoned modal** (identity-set 422; one rejection breaks all editing;
   review pass stopped on it). Open by explicit deferral. Closed by: CL-3 (add/remove →
   real bird create/delete) + P1.8 reconciliation on rejected saves, first items of
   step 4. Proof: contract test — add, remove, move, save on a canonical session all
   succeed or visibly mark the canvas dirty; a rejected save never leaves unpersisted
   edits rendered.
5. **Eaten human reviews** (silent ghost-card failures; blind CAS-retry blessing unseen
   revisions). Patched: ghost cards non-reviewable (afb5518ba); promotion sweep restored
   byte-identical approvals. Closed by: P2b.3 (no CAS-retry on approvals) + R2 (no
   silent-success writes) + P2e.3 (no-op saves preserve approvals — xfail flips). Proof:
   those tests plus the review-preservation suite (policy #11).
6. **Job-store money bugs** (re-billing succeeded units, requeue of running jobs, stuck
   jobs after crash). Open, pinned by strict xfails. Closed by: Phase 2c. Proof:
   `test_background_retry_retains_succeeded_children` and
   `test_requeue_refuses_running_jobs` flip; kill -9 batch drill in the stress rig leaves
   no stuck or double-billable state.

Standing rule: any NEW failure class observed in production gets a ledger row (class →
closing step → proof) in the same session it's observed — the ledger is the plan's
contract with reality.

## Order & estimates (amended dependency order — supersedes the phase numbering)

1. Canonical asset resolver + canonical-state classifier (A2, A3 foundations) — ~half day.
2. `hydrate_session` canonical overlay + read surfaces + DAG data model (P1.1–P1.3, P1.7)
   — ~1 day.
3. Read-back status + provenance strip (P1.8) — ~half day, lands with 2.
4. Geometry mutation service for all writers + human-work authority (P1.6, P2e.1–P2e.3)
   — ~1 day. R7 lands HERE, before any further lane work, because it protects the
   operator's ongoing review pass.
5. Generation lane boundary + job-store hardening (P2, P2c) — ~1 day.
6. Publication integrity + lifecycle state machine (P2b) — ~1 day.
7. Live shakedown: one paid regeneration + one full publish→Start on a scratch lineup;
   only then demote projection (P1.4) — ~half day.
8. Recipe + experiment manifest + cost ledger + visual evidence + tolerances
   (P2d, P2e.4–P2e.6) — ~1.5 days.
9. Phase 4 single deploy surface — ~half day, any time after step 3 stabilizes the API.
10. Census re-check, then Phase 3 deletion; Phase 5 pruning + P5.1 verbiage — ~1 day.

Total ~8 working days. Each step lands green (`uv run pytest` incl. flipped xfails, tsc,
panel+gallery+golden-path smokes) and restarts the backend through `run-backend.sh`; the
defect-ledger xfails in `tests/test_plan_contracts.py` flip to hard assertions at their
step, and each new invariant adds its contract test in the same file.

## Amendments from codex review (binding)

**A1. Phase 1 scope was understated.** Canonical-first must also cover `hydrate_session()`
(the main `GET /sessions/{id}` payload still derives dogs/hitboxes from legacy files), the
candidate overlay endpoint (rereads sidecars), gallery aggregation (globs sidecars for
confirmation counts), and candidate lookup (`sprite_animation_candidate_by_id`). Ship a
checked-in **consumer matrix** classifying every sidecar/`session.json`/`hitboxes.json` read
as canonical-runtime / generation-input / legacy-authoring / migration / export-evaluation.
Projection is deleted only after every canonical-runtime and generation consumer converts.

**A2. Canonical asset resolver.** Snapshot validity does not prove asset validity. One
resolver verifies path containment, existence, byte count, and sha256; used by candidates,
readiness, asset serving, overlay, promotion, export. Regression test deletes/replaces an
asset and asserts an integrity error, not a stale success.

**A3. Phase 2 lane selection by canonical STATE, not directory existence.**
`VALID_CURRENT` → canonical required; `MIGRATION_REQUIRED` with no canonical artifacts →
legacy; `ORPHANED_STAGE` / `QUARANTINED_INTEGRITY` / partial footprints → fail closed. The UI
selects the lane from the authoritative `canonicalState`, not "revision+birdId happen to
exist."

**A4. Phase 3 gates hardened.** `backfill_stable_ids` is a *recovery capability* (geometric
identity binding), not duplicate machinery — retire it only by explicit decision, with parity
fixtures (clean/permuted/ambiguous/partial/quarantined), a census of every authoring root
(not just find_the_dog), and `restore_verified_*` wired into migration apply first.

**A5. Ordering.** Resolver + state classifier first; `hydrate_session` overlay second; read
surfaces third; generation consumers + lane boundary fourth; live regen/export shakedown
fifth; only then demote projection; census then Phase 3; pruning last. Phase 4 independent
after the Phase 1 API contract stabilizes.

**A6. Contract cleanup (from the code review):** the contract currently conflates "generation
input provenance" with "current-scene binding" (`inputSceneSha256` equality), which forces
scene commits to rewrite history for untouched birds. Split into a provenance field (immutable
per generation) and a scene-binding check. Also: one-active-paid-job-per-bird guard
(nonce dedupes accidental retries but not deliberate cross-client double-spend), recenter
under revision-bound CAS, and an explicit `completed_stale` parent job status when zero units
committed.

## Full-editor review findings (second pass, 2026-08-12 evening)

Three further codex reviews (wizard/generation, gallery/lineup/export, job infrastructure —
same reports directory) added 51 findings. They cluster into four classes that reshape the
phases; the individual findings live in the reports and are not restated here.

**F-A. Wizard geometry writers bypass canonical CAS entirely** (wizard #1–#3, #18–#19; also
jobs #7). Auto-placement, both recenters, VLM placement, magenta finalize/reconcile, and
`/select-bg` write `hitboxes.json`/`session.json` directly on `VALID_CURRENT` sessions — no
expected revision, no snapshot commit, no review invalidation; hydration then prefers the
legacy files. This is the same disease Phase 1 treats, from the write side. **Phase 1 gains a
P1.6: one CAS-aware geometry mutation service used by every writer**, and `hydrate_session`
overlays canonical (amendment A1). Byte-identical saves must not invalidate reviews (#18 —
policy #11 applies to no-op writes too).

**F-B. Publish/lineup can ship a stale revision** (gallery #1–#7). The catalog entry is not
revision-bound to reviewed authoring; Start writes bundle files before activation succeeds;
per-variant archive un-lineups whole sessions; human-review CAS conflicts are retried
blind — the same unsafe pattern removed from extract today. Becomes **Phase 2b: publication
integrity** (revision-bound catalog entries, transactional Start, no CAS-retry on human
approvals), ordered before Phase 4.

**F-C. Job store retries re-bill and transitions are unguarded** (jobs #1–#5, #8; wizard
#7–#8, #13). Requeue erases succeeded children and re-purchases them (the failed-bird lane at
inpaint.py:4793 is the correct model to generalize); `transition_job` is last-write-wins with
no attempt generation; a quick restart can strand `running` jobs forever; magenta runs
side-effectfully inside an SSE generator instead of the durable store. Becomes **Phase 2c:
job-store hardening** (attempt generations + transition graph, succeeded-children retention on
requeue, owner-aware recovery rerun, magenta onto the durable lane).

**F-D. UI state-machine races** (wizard #4–#6, #11, #14–#17; jobs #9–#12; gallery #8, #19).
Debounced saves not flushed before paid submissions, resume pointers droppable, SSE
reconciliation that equates "session readable" with "generation succeeded". Folded into the
existing phases' UI conversions; the flush-before-paid-work rule becomes robustification R5.

Verified against today's incidents: F-A is the mechanism behind this morning's
fix-hitboxes/canonical drift; the gallery blind-retry (#1) is the same pattern that ate
review clicks. The stress battery (isolated rig, ~100 contended ops, SIGKILL mid-burst)
confirms the *canonical CAS + guarded projection* core holds — the failures are all in the
lanes that bypass it, which is the strongest argument for Phase 1/P1.6 being the payoff.

## Operator-mining amendments (2026-08-12, from the conversation corpus)

Source: `docs/research/2026-08-12-ftb-operator-message-mining.md` (two independent reads of
339 operator messages, 07-27→08-12). The mining's four product concepts map onto this plan:

- **Recipe** (mining #7, #9): versioned canonical recipe shared by UI/CLI, experiment
  manifest with human labels + cost + provenance, "adopt winner as canonical" — new
  **Phase 2d**. Kills the `deepdive`/`poststretch` tag-as-provenance pattern and the
  "write what I am looking at in a div" class of requests.
- **Revision + human-work authority** (mining #1, #5): human edits/approvals are an
  append-only authority layer; every regenerate/rebind shows an impact plan (preserved /
  invalidated / cost) before running; machine-before/human-after hitbox pairs auto-recorded
  as golden data — extends A2/R4, new **R6 (impact plan before destructive regen)** and
  **R7 (human-geometry provenance: pipeline steps refuse to overwrite human-placed geometry
  without explicit consent)**. R7 is the fix for "Did we lose all my hitbox cleanup work?"
  as a *class*.
- **Review transaction + artifact DAG** (mining #2, #3, #4, #6): explicit dependency DAG
  (background → scene → hitboxes → crops → cutouts → export) with stale-descendant
  regeneration and read-back-verified status — this IS Phase 1 + amendment A2 done
  properly; the DAG becomes the Phase 1 data model rather than an afterthought. Visual
  evidence (contact sheets, all-picked-up reconstruction, registration checks) becomes a
  mandatory run artifact (**R8**), generalizing the aspect-stretch lesson.
- **Release snapshot + lifecycle** (mining #8, #10): one state machine
  draft→review→approved→lineup→published(+archived) replacing independent flags — folds
  into **Phase 2b**; retire sprite-only compositing from all production surfaces (guard
  test already exists per the FTD parity sweep).

Addendum items: **R9 cost ledger** (measured $/stage on every revision and card, Δ$/1000
projection on recipe change), **R10 batch count reconciliation** (expected vs actual counts,
hard-fail with itemized diff), **R11 gameplay tolerances as versioned export-gate
invariants** (min tap radius, 2× tap acceptance, size uniformity, hint-on-screen, no-wrap).

## Pre-execution verification (2026-08-12, done while waiting)

- **Executable defect ledger:** `tests/test_plan_contracts.py` — strict-xfail contract tests
  reproducing four load-bearing findings (bg retry wipes paid child results; requeue accepts
  RUNNING jobs; byte-identical saves revoke reviews; auto-place bypasses canonical). All four
  reproduced. They flip to hard assertions as the phases land; add one per finding fixed.
- **Phase 3 gate — ANSWERED:** find_the_dog corpus census: 105 levels, all
  `public_only/frozen_legacy`, zero authoring sessions. FTB is 100% canonical. No corpus
  anywhere still needs the legacy migration engine; public-only resurrection is served by
  `import_authoring_from_public`. Phase 3's remaining decision is only whether to keep
  `backfill_stable_ids`' geometric rebinding as a cold recovery tool (recommend: move to
  an `attic/` with its tests, out of the import graph).
- **Consumer matrix:** drafted by codex, checked in beside the reports; verify counts during
  Phase 1, not before.
- **Stress battery:** canonical core held (see findings section); rig recipe lives in the
  session scratchpad notes — rebuild: copy one level into a throwaway workspace, run a second
  server with `LEVELBUILDER_WORKSPACE`/`LEVELBUILDER_GAME_ROOT`.

## Risks

- P1.1 changes candidate identity/geometry sourcing — the cutout panel, animation wizard, and
  sprite-eval consume candidates; sweep all three (regression rule #11).
- P3 deletion is irreversible convenience-wise; gate hard on the find_the_dog check.
- P4 touches the portal (separate repo/process); coordinate the cutover in one sitting.
