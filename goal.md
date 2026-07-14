---
title: Faithful Real-Game UI Round-Trip Evaluation in GrapesJS and Phaser Editor
type: feat
date: 2026-07-15
deadline: 2026-07-16T09:00:00+03:00
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Faithful Real-Game UI Round-Trip Evaluation

## Goal Capsule

- **Objective:** Prove whether a real FabrikaV2 game's existing mobile UI can be represented faithfully in two genuine authoring environments—GrapesJS and the licensed Phaser Editor—then edited by Batu, saved, previewed, and propagated by an agent into a physical-phone build without inventing a competing design authority.
- **Immediate experiment:** Reproduce Marble Run's complete primary UI surface in both editors first. Only after both Marble Run implementations pass the Marble Gate may the same work begin for Find the Dog (FTD).
- **Morning outcome:** By **09:00 Europe/Istanbul on 2026-07-16**, Portal should expose the strongest honest testable result: ideally four real editor projects (two games × two editors), but never at the cost of leaving Marble Run half-finished. One complete, comparable Marble Run pair is more valuable than four incomplete shells.
- **Product frame:** Fabrika is a game factory, not an editor demo. The experiment tests the missing specialization seam: existing/reference game → exact asset and UI inventory → editor-native presentation authority → saved revision → deterministic runtime preview → agent application → physical-device proof.
- **Question being answered:** Which authoring model is better at ingesting, preserving, and modifying a real game's UI: DOM/component authoring in GrapesJS or native Phaser scene authoring in Phaser Editor?
- **Not the goal:** Finishing two generic editors, rebuilding mechanics, generating art, reviving FabrikaV1, or proving that a custom Phaser web canvas can imitate an editor.
- **Execution profile:** TWF-conducted work in card worktrees, with independent subagent reviews, a per-agent ledger, PixelSmith-assisted inventory/diff work, live-device proof, and explicit handoffs. Never implement on the root/default branch.
- **Hard stops:** Do not start FTD until Marble Run passes. Do not call a lane Phaser Editor unless it is actually authored and editable in the licensed Phaser Editor. Do not claim mobile fidelity from a browser/editor render. Do not conceal unsupported edits by patching generated runtime output behind the editor.
- **Tail ownership:** Batu performs the final freeform evaluation. Agents prepare, verify, expose, and propagate projects; they do not replace Batu's judgment with a scripted score.

### Authority hierarchy

1. Current FabrikaV2 game source is authoritative for UI structure, state vocabulary, copy, asset usage, and behavior boundaries.
2. Fresh physical-device captures of current FabrikaV2 builds are authoritative for rendering, safe areas, fonts, scale, and placement.
3. Source code explains hidden states, semantic grouping, and asset bindings that screenshots cannot.
4. Each editor-native project independently authors its reproduction. Neither is generated from a third editable layout model.
5. PixelSmith may inventory, match, crop, measure, compare, and report. It is never an art generator or design authority here.
6. Runtime previews and phone builds are derived evidence, not hidden authoring surfaces.

## Product Contract

### Summary

Create one project per game per frontend:

| Game | GrapesJS | Phaser Editor |
|---|---|---|
| Marble Run | Real GrapesJS project with editable pages/components | Real licensed Phaser Editor project with editable `.scene` authority |
| Find the Dog | Real GrapesJS project with editable pages/components | Real licensed Phaser Editor project with editable `.scene` authority |

Each project reproduces the game's complete primary UI states, uses the exact existing game assets, exposes meaningful UI elements for direct manipulation, survives save/reopen, offers a runtime preview, and can feed an agent-mediated physical-device build. Gameplay mechanics may be replaced by a neutral placeholder background.

### Problem frame

FabrikaV2 can build games, but presentation authority is fragmented across source UI, templates, projections, earlier Design Sheets work, ad hoc asset bindings, and experimental editor shells. Agents then pick wrong assets, substitute visuals, or struggle to implement precise feedback such as “move this five pixels right.” Designers need an approachable visual authoring environment while FabrikaV2 remains the behavior and runtime authority.

The bottleneck is faithful round-trip specialization of the shell and HUD:

1. ingest a real implemented game's UI and assets;
2. expose it in an actual editor at useful semantic granularity;
3. let a human make normal visual edits;
4. preserve edits through save/reopen and preview;
5. let an agent propagate the saved editor state to the mobile game;
6. prove it on a physical device;
7. compare both authoring approaches honestly.

Previously built generic shells and the custom Phaser web editor/runtime are infrastructure clues only. They are not the evaluation target and do not prove this goal.

### Actors

- **A1 — Batu:** Opens each editor through Portal, freely edits UI, saves, previews, and judges which authoring experience works better.
- **A2 — Conductor:** Maintains goal discipline, TWF sequencing, agent ledger, worktree hygiene, review gates, Portal handoff, and honest status.
- **A3 — Workers/reviewers:** Implement isolated units, inspect source, and independently review fidelity/usability without changing scope.
- **A4 — PixelSmith:** Performs asset inventory, measurement, screenshot comparison, and discrepancy reporting with existing assets only.
- **A5 — FabrikaV2 runtime:** Owns behavior, SDKs, packaging, native shells, and target mobile output.
- **A6 — Portal:** Provides secure links and evidence transport, never design authority.

### Requirements

#### Sequence and scope

- **R1.** Work only in `/Users/base/dev/appletolye/fabrikav2`. Leave FabrikaV1 behind completely.
- **R2.** Finish Marble Run in both frontends before starting FTD. This is a hard gate.
- **R3.** Prefer one complete Marble pair to four shallow projects. Done beats theoretical perfection, but material defects still block completion.
- **R4.** Use one independent editor project per game per frontend. Within it, expose primary screens as separately selectable pages/scenes. Manual selection is enough for V0.
- **R5.** Reproduce the complete game-owned primary UI: menu/home, HUD, pause, settings, shop where present, win, fail, counters, health/lives, currency, hints, ads affordances, progression, modal framing, lower navigation, and any other primary surface found in current source.
- **R6.** Exclude Marble board/marbles/physics/levels and FTD searchable scenes/dogs/zoom/mechanics. Put a neutral placeholder behind gameplay HUD.
- **R7.** V0 needs one canonical primary state per surface, not every temporal/error/ad variant. Wait for delayed UI/assets before baseline capture.
- **R8.** UI may be static. Buttons need not navigate or function. Trivial interactions are acceptable only if they do not delay mapping and editability.
- **R9.** The source inventory—not an assumed screen list—determines actual required primary states.

#### Exact assets

- **R10.** Use only assets already present in the corresponding current V2 game. Preserve exact bytes, dimensions, alpha, and identity.
- **R11.** Never regenerate, redraw, restyle, substitute, or reinterpret an asset. Do not use generic Kenney unless the game source uses that exact file for that element.
- **R12.** Reproduce procedural CSS/shapes/gradients/text/Phaser primitives with equivalent primitives, not invented raster art.
- **R13.** Every asset needs stable semantic role, source-relative path, content hash, dimensions, alpha status, and source consumer(s).
- **R14.** Curated trays show semantic names and descriptions so visually similar files—such as hints and no-ads—cannot be confused.
- **R15.** PixelSmith may locate and verify source assets but may not generate or alter any image.

#### Real editor integrity

- **R16.** GrapesJS must be a real GrapesJS project whose saved pages/components/project data are that lane's presentation authority.
- **R17.** Phaser must be a native project opened in the licensed Phaser Editor application. Scene files and editor-supported project data are authority; Batu uses its scene canvas, hierarchy, properties, asset browser, transforms, and save flow.
- **R18.** The custom Phaser-based web editor/runtime does **not** count. Reuse it only as invisible validated publish/preview/device plumbing.
- **R19.** Preserve each frontend's native UX. Standardize baseline, tasks, semantics, evidence, and outputs—not editor chrome.
- **R20.** Do not introduce a shared editable layout spec. Semantic IDs, exact asset manifests, references, and validation rules may be shared read-only facts.

#### Required editability

- **R21.** Select meaningful elements through both canvas and semantic layer/hierarchy.
- **R22.** Support move/drag, resize, reorder, show/hide, duplicate, live copy editing, supported colors, and replacement from the exact-game curated tray.
- **R23.** Duplicates get stable unique instance IDs while preserving semantic role and independent selection.
- **R24.** Meaningful buttons, labels, icons, counters, badges, progress elements, modal panels, and HUD controls are individually selectable.
- **R25.** Existing composite/decorative artwork stays one asset. Do not split it to manufacture edit granularity.
- **R26.** Logical groups may move together, but meaningful children remain accessible. Batu must be able to reposition health/lives, coins/currency, hints, and similar HUD counters.
- **R27.** Editing one screen must not corrupt another or alter behavior-owned bindings.

#### Layout and fidelity

- **R28.** Author at canonical **390 × 844 portrait**, representing actual source safe-area behavior.
- **R29.** V0 scales composition to other portrait sizes while preserving relative geometry/safe areas; responsive reflow is out of scope.
- **R30.** Faithful means exact assets, copy, visible states, colors, fonts where available, hierarchy, dimensions, and placement; no missing primary UI; target geometry within about two physical pixels after device projection.
- **R31.** DOM/canvas antialiasing differences may be documented only when identity, font, color, geometry, and hierarchy are correct. They cannot excuse wrong assets, fonts, scale, or position.
- **R32.** Converge iteratively: complete all screens; fix wrong/missing assets and high-salience geometry/type/color/safe-area issues; then polish material residuals.
- **R33.** Timebox tiny pixel loops. Record imperceptible AA/shadow residuals instead of spending hours after material defects are closed.
- **R34.** Mobile fidelity is judged from current physical-device captures. Editor/browser previews are authoring aids only.

#### Persistence, preview, propagation

- **R35.** Save/reopen must preserve selection structure, hierarchy, transforms, copy, color, visibility, duplicates, and asset bindings.
- **R36.** Each project has a protected baseline, editable working state, and simple reset-to-baseline operation.
- **R37.** Each lane provides a runtime Preview derived from saved editor-native authority, without manually recreating edits.
- **R38.** Saved/published/previewed revisions are visibly identifiable; stale Preview cannot masquerade as current.
- **R39.** An agent may perform supported save/publish/apply/build steps. Full hot reload is unnecessary for V0.
- **R40.** The propagation agent must not patch runtime presentation to fake editor support. Unsupported edits remain visibly unsupported until capability is added and the edit is re-authored in the editor.

#### Device, Portal, evaluation

- **R41.** Ubuntu-connected Android is primary. Use the connected iPhone opportunistically after higher-priority proof, without letting signing/transport block the experiment.
- **R42.** Baseline capture and mobile visual convergence use live devices from the start. A later Batu-authored edit-to-phone demonstration is a distinct final workflow.
- **R43.** Portal securely links each ready editor, Preview, references/comparisons, reset instructions, status, and the agent-mediated device request. Localhost-only is not a handoff.
- **R44.** By 09:00, claimed-ready services must be running and links tested through Batu's actual route.
- **R45.** Batu evaluates with freeform exploratory edits, not a forced script or synthetic scoring ceremony.
- **R46.** Observe the same capability categories in both lanes: selection, transforms, copy/color, exact asset replacement, duplication/identity, persistence, preview freshness, and propagation feasibility.
- **R47.** Report unsupported operations, fidelity defects, delays, crashes, stale previews, asset mistakes, and manual repairs. Do not hide friction.
- **R48.** Recommend one presentation authority after evaluation; do not maintain two production authorities for one game.

#### Source modification boundary

- **R49.** Treat current Marble and FTD source as immutable baselines. Prefer thin adapters and editor organization outside game runtime.
- **R50.** Reorganize source only as last resort when it genuinely simplifies both mappings. Prove visual/behavioral neutrality on device and land it separately.
- **R51.** Do not refactor shared UI, mechanics, SDKs, or unrelated games opportunistically.

### Acceptance examples

- **AE1:** Batu moves Marble's coin counter in GrapesJS, saves, previews, reopens, and sees the same move; an agent can apply that revision without hand-editing runtime UI.
- **AE2:** Batu opens the actual Marble Phaser Editor project, selects lives/health in the native hierarchy, moves/resizes it, saves `.scene`, and sees the derived Preview update.
- **AE3:** An asset replacement uses an exact source asset and retains its content hash—not a generated or similarly named substitute.
- **AE4:** Copy edits visibly update through normal editor feedback, without Enter as a hidden publish gesture.
- **AE5:** A duplicate persists after reopen, remains independently selectable, and has a unique stable instance identity.
- **AE6:** An unsupported change is reported; no agent secretly patches runtime output and claims support.
- **AE7:** Device captures of every inventoried Marble primary surface show no material missing/wrong asset, geometry, hierarchy, color, or copy defect. PixelSmith and independent reviewers agree.
- **AE8:** Batu can reset destructive experiments to the protected canonical baseline without recloning.
- **AE9:** Portal access requires no localhost knowledge or terminal setup and clearly distinguishes editor, Preview, baseline, and working state.
- **AE10:** FTD work starts only after AE1–AE9 pass for Marble, except non-game-specific Portal/device plumbing may be prepared in parallel.

### Non-goals

- Mechanics or playable content; functional economy/ads/navigation; every transient variant; landscape/tablet responsive design; new/generated art; a shared layout authority; FabrikaV1 migration; generic shell perfection; identical editor chrome; or choosing a winner before Batu tests.

## Planning Contract

### Key technical decisions

- **KTD1:** Start from real game source and fresh device evidence, never generic shell assumptions.
- **KTD2:** GrapesJS and Phaser Editor independently encode the baseline; shared metadata validates but does not author layout.
- **KTD3:** Actual Phaser Editor or no valid Phaser lane.
- **KTD4:** Exact immutable assets; hash every binding.
- **KTD5:** One static page/scene per primary state; placeholder mechanics.
- **KTD6:** Stable semantic roles plus unique instances expose meaningful edit granularity.
- **KTD7:** Fixed 390 × 844 authoring with deterministic device safe-area/scale projection.
- **KTD8:** Native editor save is canonical; Preview is a regenerated, revision-stamped projection.
- **KTD9:** Live Android is rendering truth; iPhone is secondary while available.
- **KTD10:** Completeness before polish; timebox low-salience differences.
- **KTD11:** Strict Marble Gate before FTD.
- **KTD12:** Agent mediation is permitted, hidden visual patching is forbidden.
- **KTD13:** Portal is a review hub, not authority.
- **KTD14:** Source refactors are exceptional and independently proven.
- **KTD15:** At deadline, expose the best honest result. Never weaken Marble or overclaim FTD to show four links.

### End-to-end flow

```text
current V2 source + fresh device captures
                 |
        exact UI/asset inventory
                 |
         +-------+-------+
         |               |
  GrapesJS project   Phaser Editor project
  pages/components   .scene/hierarchy
         |               |
       native edit + save/reopen/reset
         |               |
       revision-stamped runtime Preview
         |               |
       supported agent apply/build
         +-------+-------+
                 |
    physical Android capture + PixelSmith/reviewer diff
                 |
             Marble Gate
                 |
           repeat for FTD
                 |
      Portal test hub + Batu evaluation
```

### Coordination discipline

- Run `twf orient` and reconcile live board/worktree state before trusting handoffs.
- Execute via TWF cards in isolated card worktrees; never edit/merge from root main.
- Keep a ledger per agent/model/card/unit: worktree, branch, files owned, start/end, commands, evidence, findings, disposition.
- Parallelize only independent, non-overlapping work. The Marble product gate still applies.
- Workers do not self-certify visual lanes. Use independent source/asset, editor-usability, and device-fidelity reviews.
- Verify every landing SHA exists on the integration branch before downstream/device work consumes it.
- Preserve unrelated dirty files and worktrees. Report tool/device/capacity blockers; never silently substitute browser proof.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Generic work mistaken for deliverable | Require real-game source inventory, names, assets, and screens |
| Custom Phaser web UI presented again | Native app/project/`.scene` evidence in preflight and gate |
| Misleading asset names | Consumer trace, hashes, semantic descriptions, review |
| DOM/canvas rendering differences | Hold identity/geometry/font/color constant; document AA-only residuals |
| One screen consumes schedule | Complete all states before polish; timebox P3 loops |
| Save/Preview drift | Revision stamps plus save/close/reopen tests |
| Agent masks unsupported edits | No runtime visual patching; visibly fail unsupported operation |
| Android/Phaser/Portal unavailable | Preflight all three before scene work and fail visibly |
| Deadline during FTD | Stabilize/publish Marble and report exact FTD partial state |

## Implementation Units

### U0. Live orientation and preflight

Read this file in full, root/nearby `AGENTS.md`, live TWF/board/worktrees, `origin/main`, current Marble/FTD source, existing editor artifacts, `/Users/base/dev/appletolye/phasers`, Portal routes, `tools/verify-device`, and Android/iPhone state. Classify prior artifacts as reusable infrastructure, real-game mapping, invalid custom frontend, obsolete, or unknown. Prove actual Phaser Editor launch/open/edit/save/reopen on a disposable scene, real Grapes project save/reopen, Portal access, and Android SSH/ADB/build/capture. Create cards/worktrees and ledger.

**Done:** authoritative commits/paths and reusable/invalid artifacts are recorded; both real editor persistence paths work; Portal and Android are proven or visibly blocking.

### U1. Marble source, screen, asset, and reference inventory

Trace `games/marble_run` entry points and actual shared consumers. Enumerate every primary surface/element with semantic role, instance, parent, z-order, copy, source/render method, dimensions, state visibility, and exact asset hash. Disambiguate similar assets through consumers. Capture fresh current V2 physical-device references after delayed UI loads. Define excluded mechanics and placeholder background.

**Done:** every required screen/element has traceable source and current reference; no selection rests on filename or visual guessing.

### U2. Marble in native GrapesJS

Create a Marble-specific Grapes project with one 390 × 844 page per primary state. Rebuild exact hierarchy/geometry/assets/primitives; stable semantic roles and unique instances; canvas and layer selection; exact curated asset tray; required edits; protected baseline/working state/reset; save/reopen; revision-stamped Preview. Complete all screens before fidelity polish.

**Done:** complete recognizable Marble UI, persistent required edits, and Preview derived from saved Grapes authority.

### U3. Marble in actual Phaser Editor

Create a Marble-specific licensed Phaser Editor project with one native scene per primary state (or native equivalent preserving independent selection). Use scene objects, containers, text/primitives/images, hierarchy, properties, and asset browser. Expose semantic roles/instances using editor-supported metadata; keep children selectable; provide required edits, baseline/reset, save/reopen, and revision-stamped Preview. Reuse custom Phaser work only as invisible plumbing.

**Done:** Batu can author through native Phaser Editor controls, persist changes, and see saved scenes in Preview; no custom web editor is presented.

### U4. Marble convergence and hard gate

Run source completeness and asset-hash checks. Independent reviewers exercise selection, transforms, copy/color, replacement, duplication, save/reopen, reset, and Preview freshness. Build both saved baselines to live Android and capture every state. PixelSmith compares them to fresh references. Repair high-salience defects across the complete set; document AA/shadow-only residuals.

**Marble Gate requires:** actual named frontends; every primary screen; exact assets/copy; all required edits at meaningful granularity; stable duplication; save/reopen/reset; current revision Preview; live Android captures for both; no P1/P2 material defect; resolved/accepted independent findings; usable Portal entry.

**Done:** durable PASS evidence. Without PASS, FTD stays blocked.

### U5. FTD inventory

**Dependency: U4 PASS.** Repeat U1 for `games/find_the_dog`, carefully separating shell/HUD from excluded searchable gameplay. Include current-source menu lower bar, health/lives, coins, hints, no-ads/ad affordances, settings, pause, shop, win, fail, and other primary surfaces. Wait for delayed result controls before capture.

### U6. FTD in native GrapesJS

**Dependency: U5.** Repeat U2 with exact FTD source/assets and no Marble/generic substitutions.

### U7. FTD in actual Phaser Editor

**Dependency: U5.** Repeat U3 in the licensed editor with exact FTD source/assets.

### U8. FTD convergence gate

**Dependencies: U6, U7.** Repeat U4's completeness, exact-assets, editability, persistence, Preview, PixelSmith, independent-review, and live-device gate. If time expires, publish exact partial status and leave the gate failed.

### U9. Portal morning test hub

Link every ready editor and separate Preview; label baseline/working and saved revision; link references/device comparisons and discrepancies; document reset and agent-mediated phone application; test every link through Batu's route. Keep complete Marble prominent if FTD is partial.

**Done:** Batu can begin testing without terminal access, localhost knowledge, or authority guesswork.

### U10. Batu-authored edit propagation

After mappings are secure, record Batu's saved revision, run supported apply/build through Ubuntu Android, and capture the edited state tied to that revision. Try iPhone only if healthy and non-displacing. If unsupported, document it; never patch runtime visuals to fake success.

### U11. Comparative decision handoff

After Batu's freeform testing, compare fidelity, ingestion time, discoverability, semantic clarity, transform/copy/asset ergonomics, duplication, persistence, Preview freshness, propagation effort, unsupported changes, source coupling, vendor lock-in/portability, agent labor, failure visibility, and device friction. Recommend one future authority and what infrastructure to keep/retire.

## Verification Contract

### Required proof per project

1. Open native project from clean editor launch.
2. Match all pages/scenes to source inventory.
3. Select nested elements by canvas and semantic hierarchy.
4. Move/resize a HUD element.
5. Edit copy and supported color with immediate feedback.
6. Hide/show and reorder an element.
7. Replace from exact-game tray and verify hash.
8. Duplicate and verify unique stable identity.
9. Save, close, reopen, and verify persistence.
10. Reset and verify baseline restoration.
11. Publish/save revision, open Preview, verify revision/result.
12. Build baseline to Android and capture every primary state.
13. PixelSmith and independent reviewers compare against fresh source references.

### Repository checks

Run narrow applicable workspace checks, plus repo-wide gates when touched scope warrants them:

```sh
npm run typecheck --workspace=<workspace>
npm run test:unit --workspace=<workspace>
npm run lint --workspace=<workspace>
npm run audit
npm run land-gate
```

Use `tools/verify-device` in strict live-device mode for mobile claims. Browser/Playwright may diagnose editor/Portal behavior but cannot close mobile fidelity. Discover and record actual Phaser/Grapes/Portal commands in U0 rather than inventing them here.

### Severity

- **P1 blocker:** wrong/missing primary screen, wrong/regenerated asset, invalid editor frontend, save loss, stale/misrepresented Preview, major safe-area/scale/hierarchy error, hidden runtime patch, or no device proof.
- **P2 material:** visible wrong geometry, typography, color, copy, alignment, missing affordance, broken grouping/selectability, or broken required edit.
- **P3 residual:** small AA/shadow/sub-two-pixel difference with otherwise correct identity and geometry; document and stop iterating when diminishing returns are clear.

### Independent review

The implementer is not sole approver. Use at least one independent source/asset reviewer, one editor-usability/persistence reviewer, PixelSmith for comparison, and conductor inspection of live captures. Batu owns final product judgment.

## Definition of Done

- [ ] Only FabrikaV2 was used; no new FabrikaV1 work.
- [ ] Marble has complete real GrapesJS and licensed Phaser Editor projects.
- [ ] Marble primary UI is fully inventoried and mapped with exact assets.
- [ ] Both Marble projects pass editability, semantic granularity, save/reopen/reset, and Preview checks.
- [ ] Both Marble outputs have current live Android proof and no P1/P2 fidelity issue.
- [ ] Durable Marble Gate PASS exists before any FTD implementation.
- [ ] FTD reaches the same standard in both editors, or exact partial state is reported without weakening Marble.
- [ ] Portal exposes every claimed-ready editor, Preview, reference, reset path, evidence, and propagation request securely.
- [ ] At least one honest editor-revision-to-device propagation is proven, preferably from a Batu edit, or the exact unsupported seam is documented.
- [ ] Batu can conduct freeform comparison without terminal help.
- [ ] Evidence supports a recommendation for one future presentation authority.
- [ ] TWF cards/worktrees, agent ledger, handoffs, and landing SHAs are reconciled.
- [ ] Abandoned code introduced during the goal is removed or isolated; no secret, generated build output, unexplained dirt, or fake proof is committed.

### Deadline handoff at 09:00

1. Expose the complete Marble pair if passed.
2. Expose FTD only to the degree genuinely ready, with exact missing items.
3. Keep services alive and Portal links tested.
4. Give a concise test sequence and reset path.
5. State which claims have current live-device evidence.
6. Do not spend the final window on P3 pixels while a screen, persistence, Preview, Portal, or required edit is missing.

### Required final handoff contents

- Portal URLs for editors and Previews;
- exact project/baseline paths;
- integration/main SHAs and landed cards;
- screen/capability matrix for all four intended projects;
- live-device evidence and provenance;
- reset instructions and phone propagation instruction;
- unresolved P1/P2/P3 issues separated;
- per-agent ledger summary;
- honest unfinished/unverified list;
- first action Batu should take when testing.

## Appendix

### Mandatory first reads for any executor

Before implementation, read **this file in full**, then inspect:

1. root and nearest `AGENTS.md`;
2. live `twf orient`, board/cards, worktrees, and `origin/main`;
3. `games/marble_run/**` source, refs, evidence, manifests, and actual shared consumers;
4. after Marble Gate only, `games/find_the_dog/**` equivalents;
5. existing GrapesJS/Phaser branches and artifacts, distinguishing native projects from generic/custom prototypes;
6. `/Users/base/dev/appletolye/phasers` for Phaser Editor/license/project context;
7. Portal secure routing conventions;
8. `tools/verify-device`, device registry, Ubuntu SSH/ADB, and current iPhone state;
9. relevant project-local visual/device skills and PixelSmith workflow;
10. prior handoffs only after checking them against live state.

If this file conflicts with live board state about ownership/landing, trust the board and report it. If old handoffs conflict with current behavior, trust current source and device evidence. If a shortcut conflicts with this Product Contract, stop and raise it rather than silently changing the goal.

### End steps in strict order

1. Orient TWF; establish clean card worktrees and agent ledger.
2. Prove actual GrapesJS, licensed Phaser Editor, Portal, and Android paths.
3. Inventory Marble source, primary screens, exact assets, and semantic elements.
4. Capture fresh current Marble references on device after delayed UI loads.
5. Build complete Marble Grapes pages with exact assets and editing.
6. Build complete Marble native Phaser Editor scenes likewise.
7. Verify save/reopen, baseline/reset, and revision-stamped Preview in both.
8. Run completeness and exact-asset checks.
9. Build both baselines to Android and capture every primary state.
10. Run PixelSmith and independent reviews; repair P1/P2 defects across the screen set.
11. Record Marble Gate PASS; otherwise continue Marble and do not start FTD.
12. Inventory and freshly capture FTD.
13. Build FTD in GrapesJS and Phaser Editor.
14. Run FTD persistence, Preview, device, PixelSmith, and independent-review gate.
15. Publish/test Portal links, evidence, reset instructions, and honest status by 09:00.
16. After mappings are secure, propagate a Batu-authored edit to Android; try iPhone opportunistically.
17. Observe Batu's freeform evaluation without steering toward a predetermined winner.
18. Recommend one future authority and what to keep, change, or retire.
