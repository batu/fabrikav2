# FTB Level-Generation Operator Message Mining

**Source:** `/private/tmp/claude-501/-Users-base-dev-appletolye/32e0aa6d-8a4c-4e44-94bf-4731b527b535/scratchpad/user-levelgen.txt`  
**Scope:** The operator's own FTB hidden-object level-generation and level-editor messages, 2026-07-27 through 2026-08-12. Marble Run, Anket, Portal infrastructure, and unrelated game work were excluded.  
**Ranking:** Qualitative frequency across messages and sessions multiplied by the cost of rework, lost human review, provider spend, or manual inspection. Repeated duplicate transcript lines were treated as one utterance, not independent evidence.

## Executive finding: the real workflow is a correction loop, not a step wizard

The operator's actual loop is:

1. Generate a comparable candidate with a known preset and provenance.
2. See the full level, overlays, cutouts, and variants in one reliable review surface.
3. Correct hitboxes and padding by hand; approve that exact governed content.
4. Regenerate only the affected downstream artifacts, with an impact preview.
5. Read back the saved revision and visually inspect it in the editor and game.
6. Archive rejects; promote approved levels into a lineup; build that exact lineup.
7. Turn accumulated human corrections into golden data and improve defaults.

The tool appears to model these as loosely connected stages and views. That mismatch makes the operator repeatedly reconstruct provenance, ask what a button changed, redo geometry, and verify whether the system used the current artifacts at all. The best simplification is therefore not another knob: it is one revisioned **review → correct → regenerate affected artifacts → verify → promote** transaction.

## Top 10 improvement areas

### 1. Preserve human work across regeneration, migration, and state repair

**Pattern.** The highest-cost trust failure is loss or apparent loss of reviewed hitboxes, review approvals, and archive decisions. Human corrections are the scarce artifact; the pipeline currently treats them as disposable stage state.

**Evidence.**

- 2026-08-07: “Did we lose all my hitbox cleanup work?”
- 2026-08-12: “the 17 hitbox review I made disappeared”
- 2026-08-12: “Did you also unarchive the things that I made”

**Proposal.** Make human edits and approvals an append-only, revisioned authority layer keyed by stable level and object identities. Before any regenerate/rebind/migrate operation, compute and show an impact plan: preserved edits, invalidated edits, regenerated artifacts, and reason. Carry approval forward when governed content hashes and identities are unchanged. Require an explicit confirmation only for actual human-work invalidation, create an automatic snapshot, and offer a one-click restore/diff.

### 2. Replace implicit regeneration with a dependency-aware transaction

**Pattern.** The operator repeatedly has to ask which upstream step must be rerun and whether hitbox changes force cutout or sprite regeneration. Regeneration boundaries are unclear and broad, causing fear of deleting a level or rebinding everything.

**Evidence.**

- 2026-08-12: “What step do we need to regenerate? Delete whole level? Redecide the hitboxes? what?”
- 2026-08-07: “This wont require a regeneration of sprites right?”
- 2026-08-12: “SO ARE WE GOING TO REEXTRACT THE BIRDS AS WELL FROM HITBOXES?”

**Proposal.** Encode the artifact DAG explicitly: background → painted scene → hitboxes → padded crops → cutouts → playable export. A single `regenerate` action should diff inputs, mark only descendants stale, preview cost and affected approvals, execute idempotently, and resume safely after failure. Remove “delete whole level” and manual rebinding as normal recovery paths.

### 3. Make save and freshness claims truthful through read-back

**Pattern.** The UI reports success while showing old artifacts, builds contain uncertain revisions, and the operator repeatedly asks whether the editor/game is current. Status presently reflects request completion, not durable state and consumer adoption.

**Evidence.**

- 2026-08-12: “It says extraction saved but I see the old version”
- 2026-08-05: “are the levels up to dat eon the level editor? Because the game stıll ıs broken”
- 2026-08-06: “I also dont know if you correctly updated the level for build 18.”

**Proposal.** After every mutation, read back the persisted revision and render that exact revision. Show a provenance strip on every view: level revision, artifact hashes, generation method/model, approval revision, lineup snapshot, and consuming build. Replace generic “saved” with precise states such as `persisted`, `rendered from revision N`, `export stale`, and `included in build X`. Fail visibly on mismatch.

### 4. Collapse fragmented review screens into one operator review workspace

**Pattern.** The operator repeatedly asks to see levels, hitboxes, cutouts, full images, and comparison overlays together. Actions appear in the wrong views, disappear unexpectedly, or have unclear effects.

**Evidence.**

- 2026-07-29: “I cant see the hud overlay nor the three compar'son”
- 2026-08-04: “make sure these levels are visible and the hitboxes are visible in the web level editor”
- 2026-08-04: “However I edited the hitboxes in the review view. What does that do?”

**Proposal.** Create one review workspace per level with synchronized full-scene and object-detail panes, toggles for hitboxes/padding/cutouts/all-picked-up, variant comparison, and a persistent action rail. Keep gallery actions limited to triage, review actions to edit/approve, and lineup actions to ordering/promotion. Every edit should show its affected artifacts before save and its resulting revision afterward.

### 5. Treat hitbox and padding correction as first-class geometry, then learn from it

**Pattern.** The operator repeatedly centers and enlarges hitboxes and padding, especially for large or adjacent birds. Automatic placement is often too small, between two birds, or missing visible accessories; hard limits and blockers make correction harder.

**Evidence.**

- 2026-08-05: “now I manually added hitboxes. some birds are way bigger than the hitboxes”
- 2026-08-06: “The two bird situation still has small and off space birds.”
- 2026-08-12: “padding has the same 4 point scale points like the sprite.”

**Proposal.** Use one editable geometry primitive for hitbox, padding, and sprite bounds with four-corner/edge handles, numeric entry, overlays, and no arbitrary 120 px ceiling. Default padding from visible-object masks, enforce configurable minimum tap radius, and detect neighbor overlap without hard-blocking human overrides. Record machine-before/human-after pairs automatically as golden training data and regression cases.

### 6. Put visual evidence inside the pipeline, not in ad hoc reports

**Pattern.** Completed jobs and text reports repeatedly fail to expose obvious image defects. The operator has to demand full images, working image loads, correct framing, and a specific screenshot before the defect is acknowledged.

**Evidence.**

- 2026-08-03: “your report shows no images”
- 2026-08-04: “Show the full levels as well and for the mother of god please make the images load properly”
- 2026-08-05: “take a screenshot of level 7 after picking up the bird ... And look at it”

**Proposal.** Make visual gates mandatory artifacts of each run: full-level before/after, overlays, all-picked-up reconstruction, representative pickups, and image-load assertions. Generate a self-contained comparison surface from immutable local assets. Block promotion on missing/broken evidence, dimension/aspect mismatch, or registration error. For runtime pickup/compositing claims, attach real-device captures rather than browser-only completion signals.

### 7. Establish one canonical preset and guarantee editor/CLI parity

**Pattern.** The operator repeatedly asks for the same prompt/style/model settings, CLI execution, correct Bird terminology, and a canonical default. Configuration is scattered enough that experiments silently diverge or retain Find the Dog language.

**Evidence.**

- 2026-07-29: “Some of the prompts still have the word dog, and in the UI as well”
- 2026-08-04: “we need to use the same prompt, please, including the sytle as well”
- 2026-08-05: “set as the defaults, supported in the editor, and using the CLI”

**Proposal.** Define a versioned `FTB canonical` recipe as the sole source of truth for prompt templates, model, dimensions, safe areas, placement, inpaint, cutout, and export settings. Both UI and CLI should call the same operations and serialize the same recipe revision. Add a dry-run recipe diff and tests banning Dog-specific copy/config in Bird recipes. Move experimental overrides behind an explicit “experiment” mode that cannot silently become production.

### 8. Turn archive, review, lineup, catalog, and build inclusion into one state machine

**Pattern.** The operator manually reconciles counts and asks what is archived, unarchived, in the lineup, in the catalog, or actually in the game. Invalid combinations are possible, such as archived levels remaining lined up.

**Evidence.**

- 2026-08-04: “How many levels are unarchived still?”
- 2026-08-07: “Catalog levels not in the lineup what are these”
- 2026-08-07: “archive should automatically unline up the thigns”

**Proposal.** Replace independent flags with explicit lifecycle states and guarded transitions: `draft → needs review → approved → lineup → published`, plus `archived`. Archiving atomically removes lineup membership; publishing snapshots an ordered set of approved revisions. Show counts and inconsistencies in one reconciliation panel and make the game build consume a named immutable lineup snapshot.

### 9. Make experiments self-identifying and comparable by default

**Pattern.** Model, composition, resolution, and batching experiments proliferate, but the operator repeatedly cannot tell which level is which, asks for labels, or requests the same comparison layout and cost accounting again.

**Evidence.**

- 2026-08-05: “write the name of the model to the level so I can easily understand it”
- 2026-08-05: “for the love of god please write what I am looking at in a div on the level”
- 2026-08-05: “I just want to see the 10 results of the top 2 approaches. All 10.”

**Proposal.** Introduce a first-class experiment manifest and comparison view. Every candidate gets a human label plus immutable recipe, seed, model, source revision, cost, duration, and artifact hashes. Provide a standard matrix/contact sheet and an “adopt winner as canonical” action. Remove ad hoc tags such as `deepdive` and `poststretch` once the manifest can express those dimensions.

### 10. Retire rejected composition lanes and keep the production path narrow

**Pattern.** Sprite-only/pasted compositing and multiple pickup/composition modes consumed substantial work, were explicitly rejected, then remained confusing enough to be revisited. The desired production behavior is painted-in birds that blend with the scene, with clean cutouts used for pickup—not pasted sprites as the level image.

**Evidence.**

- 2026-08-01: “just adding the sprites to the level is not working ... Please drop that goal”
- 2026-08-04: “We want the animals to blend-in to the scene. So the image painting model has to see it.”
- 2026-08-05: “We are not going to push on the cutout composite version.”

**Proposal.** Remove sprite-only compositing from the normal wizard, gallery, and publish path. Preserve it only as a clearly labeled archived experiment if reproducibility matters. Canonicalize painted-scene gameplay plus separately extracted pickup sprites and an all-picked-up/background reconstruction gate. This eliminates a confusing lane and prevents mechanically green but visually rejected output from returning.

## Simplified target product shape

The ten areas collapse into four product concepts:

1. **Recipe:** one versioned canonical definition shared by UI and CLI.
2. **Revision:** immutable inputs/artifacts plus preserved human corrections and approvals.
3. **Review transaction:** inspect, edit, preview impact, regenerate only stale descendants, read back, and approve.
4. **Release snapshot:** an explicit approved lineup revision consumed by a named build.

Everything else—tags used as provenance, ambiguous save toasts, manual count reconciliation, rebind rituals, scattered overlays, and production-visible experiment knobs—can be deleted or demoted. That is the clearest path to both simplification and robustness.

## Addendum: three areas from an independent second read (Claude, same corpus)

**A. Cost is a first-class output, not an afterthought.** "give me a cost analysis for all
available models" / "when you make 1000 levels each cent counts" (08-05); "Overall how much
does it cost to generate one square level with 20 birds and cutouts" (08-04). The operator
priced every lane by hand. Proposal: the experiment manifest (#9) and every level revision
carry measured $ per stage from the merceka ledger (never estimated), and the editor shows
$/level on the card; recipe changes show a projected Δ$/1000 levels.

**B. Batch operations need a count ledger.** "the math doesnt check out. we had 30 you spent
15 and now we have 10" (08-06); "Dude why did you do 6 birds, can you please generate all of
it?" (08-04, twice). Proposal: every batch job declares expected counts up front
(levels in, birds per level, artifacts out), reconciles actual vs expected at completion,
and a mismatch is a hard failure with an itemized diff — never a silently smaller output.

**C. Gameplay tolerances stated in chat must become export-gate invariants.** Minimum tap
radius ("minimum (38px?) ... Lenient is good", 08-06), tap acceptance at 2× hitbox (08-05),
hitbox size uniformity ("I reall dont want the boxes to differ in size that much", 08-06),
hint-must-be-on-screen and no-wrap-after-last-level (08-07). Each was a chat instruction;
none is a validated invariant. Proposal: encode as export-gate/runtime-config checks with
the numbers versioned in the canonical recipe, so a regenerated level can never regress a
tolerance the operator already set.
