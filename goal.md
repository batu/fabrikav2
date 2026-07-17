---
title: Marble Run Exact-Asset Pixel-Fidelity Round Trip
type: feat
date: 2026-07-15
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
---

# Marble Run Exact-Asset Pixel-Fidelity Round Trip

## Goal Capsule

- **Objective:** Make Marble Run's UI a faithful, editable, one-to-one mapping in both the real GrapesJS project and the licensed native Phaser Editor project, then prove that saved edits can be previewed and propagated to a physical phone.
- **Only game in scope:** Marble Run in FabrikaV2. Do not start, prepare, or improve Find the Dog. Do not touch FabrikaV1.
- **Highest priority:** Exact original asset identity. A visually similar, procedurally recreated, regenerated, generic, or conveniently substituted asset is wrong even when the surrounding layout looks good.
- **Second priority:** Pixel fidelity on physical-device output: geometry, scale, safe area, copy, font, color, hierarchy, and visibility.
- **Known blockers:** GrapesJS currently uses the wrong saga tiles. Phaser currently renders shapes that are not the original hearts. Both are P1 failures and must be corrected before lower-salience polish.
- **Evaluation target:** Batu can open both real editors, freely move or edit Marble UI, save, reopen, preview the same revision, and have an agent propagate that revision to the phone.
- **Product frame:** This is not an editor demo or a generic game shell. It is a proof that FabrikaV2 can specialize an already implemented real game's UI without losing asset identity or visual fidelity.

## Authority and Scope

### Authority hierarchy

1. Current FabrikaV2 Marble Run source and its actual asset consumers define which assets, copy, states, fonts, primitives, and hierarchy are correct.
2. Fresh physical-device captures of that same current source define rendered placement, scale, safe areas, and appearance.
3. Exact asset bytes in the current Marble Run dependency graph are immutable authorities. Filename similarity or visual resemblance is never enough.
4. GrapesJS project data is the Grapes lane's editable presentation authority.
5. Native Phaser Editor `.scene` files are the Phaser lane's editable presentation authority.
6. Shared manifests may validate identity and semantics but must not become a third editable layout authority.
7. Browser previews are authoring aids. Physical-device captures are final rendering evidence.

### Included

- Marble Run menu/home and saga progression surface.
- Gameplay HUD over a neutral placeholder background.
- Pause.
- Menu settings and level settings where they are distinct.
- Shop.
- Win.
- Fail.
- Finale/completion surface if it is part of the current primary UI.
- Every visible shell/HUD element used by those primary states: title/banner, saga tiles and nodes, hearts/lives, coin and other counters, buttons, icons, panels, badges, labels, progress, settings controls, navigation, and decoration.
- Real GrapesJS authoring, real licensed Phaser Editor authoring, persistence, reset, revision preview, Portal access, Android proof, and optional iPhone corroboration.

### Excluded

- Find the Dog and every other game.
- FabrikaV1.
- Marble physics, marbles, board logic, level mechanics, win calculation, or playable gameplay.
- The board, marbles, routes, and gameplay preview may use the neutral placeholder in every state, including Menu, Shop, and modal underlays. Reviewers must exclude only those regions while still judging every shell, HUD, saga, and menu UI element.
- New or regenerated art.
- Generic shells or generic Kenney substitutions unless the current Marble source actually consumes that exact file for that exact role.
- The custom Phaser web shell as an authoring frontend.
- A shared editable layout schema between GrapesJS and Phaser Editor.
- Functional navigation or economy unless trivial and non-blocking.

## Product Contract

### R1. Exact asset identity is a hard gate

- Every visible raster image in both editors must map to an exact asset used by current Marble source.
- Record for every binding: semantic role, source consumer, source-relative path, SHA-256, byte size, pixel dimensions, alpha status, and the editor object/component that uses it.
- Validate the bytes used by each editor against the source SHA-256. Do not validate only filenames or copied paths.
- If current source uses an atlas region, preserve the exact atlas image and exact frame/region identity.
- If current source constructs an element from primitives, text, CSS, or Phaser graphics, reproduce that construction with equivalent native primitives. This exception applies only after source inspection proves no raster/vector asset owns the visible element.
- Never replace an existing asset with an approximation because it is easier to scale, tint, crop, select, or animate.
- Never regenerate, redraw, trace, restyle, reinterpret, or procedurally imitate an existing source asset.
- Do not split a composite source asset into invented pieces merely to increase editability.
- Membership in the Marble inventory or curated tray is necessary but not sufficient. Every visible image, vector, atlas frame, font, and source-native primitive must match the exact current-source consumer for that semantic role. An asset used elsewhere in Marble Run is still a prohibited substitute when bound to the wrong role.
- Font identity is part of the exact-asset gate. Each text object must use the family that current source resolves in the proven capture environment; packaging a fallback does not authorize using it while the higher-priority source family is available.

### R2. Asset selection must be consumer-traced

- Start from current code consumers and runtime bindings, not asset filenames.
- Build a complete visible-element inventory for every included state before declaring either lane faithful.
- Similar assets must be disambiguated by the code path that renders them, state conditions, dimensions, and hash.
- The curated GrapesJS tray and Phaser asset pack must expose only approved exact Marble assets for this project, with semantic labels and descriptions.
- An asset is not approved until the inventory identifies its real source consumer.
- Add a deterministic audit that fails on unknown, missing, substituted, regenerated, or hash-mismatched visible assets.
- Require a closed-world mapping: every source-derived visible inventory entry maps to the named editor object(s) with explicit cardinality, and every visible editor object maps back to one approved inventory entry or proven source-native primitive.
- Record the full 40-character source commit and digests of all relevant consumer files. Validation must fail when the reviewed source snapshot, consumer digests, or recorded runtime selection drift.
- Every approved binding must declare `game: marble_run` and resolve beneath `games/marble_run`, or to a shared file proven by a current Marble consumer. Other-game, generic-pack, generated, remote, data-URL, and unproven shared origins fail even if copied into a Marble directory.

### R3. Known wrong assets are P1 blockers

- Replace the wrong GrapesJS saga tiles with the exact tiles/frames consumed by current Marble source.
- Replace the Phaser pseudo-hearts/primitives with the exact heart/life asset or exact source construction proven by current Marble consumers.
- Audit both lanes for the same failure class after those repairs; do not assume only the two reported elements are wrong.
- No geometry or polish pass may declare success while either known blocker or another wrong-asset finding remains.

### R4. Complete primary-state mapping

- Both lanes must represent the same source-derived primary state list.
- One separately selectable GrapesJS page and one separately selectable native Phaser scene per primary state is acceptable for V0.
- UI may be static and manually selected.
- Gameplay uses a neutral placeholder background, but every shell/HUD element must remain source-faithful and editable.
- Do not omit a primary surface merely because current reference capture is missing; source inventory determines required coverage.

### R5. Pixel fidelity

- Author at canonical 390 x 844 portrait with current-source safe-area behavior.
- Match exact asset scale/crop, position, anchor/origin, z-order, visibility, copy, font, weight, size, line height, color, panel geometry, and grouping.
- Target approximately two physical pixels of geometric difference after device projection.
- Wrong asset identity, missing elements, wrong font, major scale, crop, safe-area, hierarchy, or state errors are P1.
- Visible geometry, typography, color, copy, alignment, and grouping errors are P2.
- Only antialiasing, shadow, or sub-two-pixel residuals may remain as documented P3s.
- Iterate breadth-first: correct asset identity and complete all states, repair major geometry/type/safe-area issues across the set, then polish residuals. Do not spend hours on one tiny pixel while another state contains wrong assets.

### R6. Native authoring integrity

- GrapesJS must use actual GrapesJS pages/components/project persistence.
- Phaser must open and edit in the installed licensed Phaser Editor; native `.scene` files and supported project metadata are authority.
- The custom Phaser web editor does not count.
- Meaningful UI elements must be selectable through canvas and semantic layer/hierarchy.
- Support move/drag, resize, reorder, show/hide, duplicate, live copy editing, supported color changes, and replacement from the exact approved Marble asset set.
- Logical groups may move together, but important children such as hearts/lives, coin counter, saga nodes/tiles, labels, and buttons must remain independently accessible.
- Duplicates require stable unique instance IDs without changing semantic role.

### R7. Persistence, reset, and preview

- Save, close, and reopen must preserve hierarchy, transforms, copy, color, visibility, order, duplicates, and exact asset bindings.
- Both lanes require a protected exact baseline and a deterministic reset-to-baseline path.
- Preview must be regenerated from the saved native authority and visibly identify the exact editor revision.
- Stale Preview must fail visibly.
- Agents may mediate save/publish/apply/build steps but may not patch runtime visuals to fake editor support.

### R8. Device truth and visual proof

- Ubuntu-connected Android is the primary proof device. Use the connected iPhone as corroboration when available without letting signing block Android proof.
- Build each lane from its exact saved revision and embed source SHA, lane, editor revision, publication digest, and package identity.
- Capture every primary state for current source, GrapesJS output, and Phaser output.
- Record APK/app hash, installed package identity, device identity, foreground activity, state marker, capture hash, and timestamp.
- PixelSmith compares each editor-derived device capture to the corresponding fresh current-source device reference.
- PixelSmith may judge, measure, crop, and compose comparisons. It may not generate or repair assets.
- Browser/editor screenshots cannot close the mobile fidelity gate.

### R9. Portal and human evaluation

- Portal must securely link both real editors, their revision previews, exact-asset inventory, device comparisons, known findings, baseline/reset instructions, and agent-mediated phone application action.
- No localhost knowledge or SSH tunnel should be required for Batu's normal test path.
- Batu performs freeform edits; the system observes clarity, speed, persistence, fidelity, propagation effort, and unsupported operations without steering toward a predetermined winner.

### R10. Execution discipline

- Work through current TWF card worktrees, not root/main.
- Reconcile live board, worktree, integration branch, and `origin/main` before acting.
- Keep a per-agent ledger with agent/model, card/unit, branch/worktree, owned files, commands, evidence, findings, and disposition.
- Use independent source/asset and editor-usability reviewers; implementers do not self-certify.
- Verify every landing SHA on the integration branch before downstream/device work consumes it.
- Do not begin or prepare FTD after Marble passes; this goal ends with Marble Run.

## Implementation Units

### U0. Reorient and freeze scope

- Read this file in full and run `twf orient`.
- Reconcile live board/cards/worktrees, integration branch, `origin/main`, services, Portal, Android, iPhone, and editor processes.
- Mark every FTD card or workstream out of scope for this goal.
- Preserve the currently live Portal service; do not let deployment cleanup displace Marble fidelity work.

**Done:** one authoritative Marble worktree/branch chain and agent ledger are identified; no FTD worker is active.

### U1. Exact source/asset audit

- Trace every included visible element from current Marble source to actual asset or proven source primitive construction.
- Produce the canonical screen/element/asset inventory with hashes and consumers.
- Compare both existing editor projects against it.
- Emit a discrepancy list headed by wrong saga tiles and wrong Phaser hearts, then every other wrong, unknown, missing, or untraceable binding.
- Add deterministic exact-asset validation.

**Done:** every visible element in every included state is either hash-bound to its exact source asset or explicitly proven to be source-native text/primitives; zero ambiguous bindings remain.

### U2. GrapesJS asset and fidelity repair

- Repair wrong saga tiles first.
- Repair every other exact-asset audit failure.
- Complete missing primary elements/states.
- Converge high-salience geometry, typography, safe area, and hierarchy.
- Verify required edit operations, save/reopen, reset, and revision preview.

**Done:** GrapesJS passes exact-asset audit and has no unresolved P1/P2 across the complete primary-state set.

### U3. Phaser Editor asset and fidelity repair

- Replace fake/non-source hearts first using the exact source heart/life binding or exact source construction established by U1.
- Repair every other exact-asset audit failure.
- Complete missing primary elements/states in native `.scene` authority.
- Converge high-salience geometry, typography, safe area, and hierarchy.
- Verify required edit operations, save/reopen, reset, and revision preview inside the licensed editor.

**Done:** native Phaser Editor passes exact-asset audit and has no unresolved P1/P2 across the complete primary-state set.

### U4. Revision-bound Android proof

- Project current source, GrapesJS revision, and Phaser revision into deterministic state tours.
- Build/install each exact revision on Android and capture all states with provenance.
- Run PixelSmith comparisons and independent reviews.
- Repair and recapture all P1/P2 findings.

**Done:** complete revision-bound source/Grapes/Phaser device sets exist and reviewers report no unresolved P1/P2.

### U5. HITL edit-to-phone round trip

- Publish the Marble-only Portal test hub.
- Batu edits both projects freely.
- Record each saved revision and propagate it through the supported agent path to the phone.
- Capture the edited result and record friction or unsupported operations honestly.

**Done:** Batu can compare the two real authoring models using the same faithful Marble baseline and see supported saved edits on the phone.

### U6. Marble-only decision handoff

- Compare exact fidelity, asset safety, edit ergonomics, semantic clarity, persistence, preview freshness, propagation effort, vendor lock-in, and agent labor.
- Recommend one presentation-authority direction and what infrastructure to keep or retire.
- End the goal. Do not continue into FTD.

## Verification Contract

### Hard automated gates

1. The source-derived screen inventory is complete.
2. Every visible raster binding in both lanes has an approved source path and matching SHA-256.
3. No visible binding resolves to a generated, generic, substituted, unknown, or unconsumed asset.
4. Saga tile bindings match current source consumers exactly.
5. Heart/life bindings match current source consumers exactly.
6. Both projects reopen with exact bindings and saved edits intact.
7. Preview revision equals saved editor revision.
8. Android build provenance equals the reviewed saved revision.
9. Every primary state has source, GrapesJS, and Phaser device captures.
10. PixelSmith and independent review contain zero unresolved P1/P2.
11. The inventory's full source commit and consumer-file digests equal the reviewed checkout.
12. Every semantic role passes an exact role-to-asset/frame/font/primitive compatibility map; curated-set membership alone does not pass.
13. Inventory-to-editor coverage is closed-world with explicit repeat counts; no required visible element is missing and no visible object is unowned.
14. Fallback-only, imported-unused, or provenance-only assets are ineligible as active baseline bindings or replacement choices.
15. Both manifests validate `game: marble_run`, canonical source roots, and the absence of other-game, generic, generated, remote, or unproven origins.

### Required HITL checks in each editor

1. Select saga tile/node, hearts/lives, coin counter, primary CTA, and modal content through canvas and hierarchy.
2. Move/resize one HUD element.
3. Edit copy and a supported color with immediate feedback.
4. Hide/show and reorder an element.
5. Replace an image only from the approved exact Marble asset set and verify its hash.
6. Duplicate an element and verify independent stable identity.
7. Save, close, reopen, and confirm persistence.
8. Open revision-matched Preview.
9. Reset to the protected exact baseline.
10. Propagate a saved Batu edit to the phone through the agent-mediated path.

## Definition of Done

- [ ] Only Marble Run in FabrikaV2 was worked.
- [ ] GrapesJS saga tiles are the exact current-source assets/frames.
- [ ] Phaser hearts/lives are the exact current-source asset/construction, not approximations.
- [ ] Every visible element in both lanes has deterministic source provenance.
- [ ] Both lanes contain the complete source-derived primary UI state set.
- [ ] Both lanes use real native authoring authority and support required edits.
- [ ] Save/reopen/reset and revision previews are proven.
- [ ] Source, GrapesJS, and Phaser have complete revision-bound physical-device captures.
- [ ] PixelSmith and independent reviewers report no unresolved P1/P2.
- [ ] Portal exposes a Marble-only test hub without terminal setup.
- [ ] Batu can make edits in both editors and see supported saved revisions propagated to the phone.
- [ ] A Marble-only comparative recommendation is delivered.
- [ ] No FTD work was started or prepared under this goal.

## Mandatory First Reads and End Order

Before implementation, read this file in full, then root and nearest `AGENTS.md`, live TWF orientation/board/worktrees, the current Marble source and all actual asset consumers, existing Marble editor authorities/publications/evidence, Portal routing, PixelSmith workflow, and live device paths. Trust current source and live board state over stale handoffs.

Execute in this order:

1. Reorient TWF and freeze scope to Marble only.
2. Build the exact source consumer and asset-hash inventory.
3. Audit both current lanes against that inventory.
4. Fix GrapesJS saga tiles and all other asset-identity failures.
5. Fix Phaser hearts and all other asset-identity failures.
6. Complete and converge all primary states across both lanes.
7. Verify editor operations, save/reopen/reset, and revision previews.
8. Build revision-bound source/Grapes/Phaser Android tours.
9. Capture all states, run PixelSmith and independent review, and repair all P1/P2.
10. Publish the Marble-only Portal hub.
11. Run Batu's freeform edit-to-phone evaluation in both lanes.
12. Deliver the Marble-only recommendation and stop.
