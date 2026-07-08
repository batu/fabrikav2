---
title: "feat: Wire Cameleon Lido art integration"
type: feat
status: active
date: 2026-07-08
origin: docs/brainstorms/2026-07-08-cameleon-art-integration-requirements.md
trello: https://trello.com/c/cHf5RquT
---

# feat: Wire Cameleon Lido art integration

## Summary

Implement the accepted Sunwash Lido art as a real data/runtime integration: update the level schema for three 1440 px panels while preserving five logical hide zones, generate or derive the missing sprite variants without new image spend, register every production asset key, and make Phaser load the real PNGs instead of placeholder textures. The plan keeps conductor-approved riso/night panel aliases explicit and leaves visual completion to later real-device evidence.

---

## Problem Frame

The accepted art manifest changed Cameleon's binding geometry from a five-panel 4800x1440 placeholder world to a three-panel 4320x1440 production panorama. Current code still enforces the old shape, generates placeholder textures, renders decoys as outlines, and only displays the selected direction in the HUD. The next worker needs to land art, schema, runtime loading, provenance, and tests together so the later device stages can inspect the actual lido rather than a proxy.

---

## Assumptions

*This plan was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input - un-validated bets that should be reviewed before implementation proceeds.*

- Keep `world.zoneWidth` as the conductor-specified 1440 px panel width, and add a separate logical-zone mapping helper for five gameplay/read-order zones.
- Derive riso/night organic hide variants locally from the accepted poster/white alpha masks rather than aliasing them silently or spending on new image generation.
- Treat riso/night poster-panel aliases as the only conductor-approved temporary panel gap, with explicit alias metadata and TODO text that names the post-device-proof follow-up.
- Use a small Cameleon-specific asset registry instead of building a general asset pipeline for all games.
- Preserve the existing generated-art provenance appended in `games/cameleon/design/asset-identity.json` when extending sign-lane generation for `li-06`.

---

## Requirements

- R1. Preserve origin requirements R1-R6: `games/cameleon/public/levels/lido/level.json` represents a 4320x1440 world, three 1440 px panels per direction, non-hittable seam-pillar overlays at x=1440 and x=2880, and explicit later evidence targets for the 64 px seam-blend review zones.
- R2. Preserve origin requirements R7-R12: hide and decoy placement follows `games/cameleon/docs/placement-manifest.json` and conductor host-prop notes, with alpha-locked painted/white sprite pairs.
- R3. Preserve origin requirements R13-R16: runtime asset keys resolve to real PNG textures, direction changes update visible art without resetting game state, and `?dir=` plus `?bodies=` continue to work.
- R4. Preserve origin requirements R17-R19: every generated, derived, authored, aliased, or conductor-accepted production asset has auditable provenance and does not hide spend outside `games/cameleon/docs/gen-ledger.md`.
- R5. Preserve origin requirements R20-R24: unit coverage proves geometry, asset completeness, aliases, alpha-lock, and direction behavior; worker close-out uses `npm run typecheck -w @fabrikav2/cameleon`, `npm run test:unit -w @fabrikav2/cameleon`, `npx eslint .`, and `npm run audit`, while real visual completion remains device-stage evidence.

**Origin actors:** A1 Player, A2 implementation worker, A3 conductor/reviewer, A4 Cameleon runtime, A5 audit/test runner.

**Origin flows:** F1 Poster Pop production render, F2 Direction selection, F3 Found/reveal integrity.

**Origin acceptance examples:** AE1-AE3 and AE5-AE7 are implementation-stage targets. AE4 is prepared by seam data/runtime work but remains unclosed until later real-device visual evidence reviews x=1440 and x=2880.

---

## Scope Boundaries

- Do not generate missing riso/night panel backgrounds in this card; the conductor owns those after device proof.
- Do not spend on new model-generated art in this card unless the conductor explicitly approves it and the generation is recorded in `games/cameleon/docs/gen-ledger.md`.
- Do not change hide roster, difficulty order, win-at-8, play modes, ammo rules, or found-beat behavior.
- Do not use browser E2E or desktop screenshots as completion proof for mobile-game visuals.
- Do not open a pull request from this twf worker flow.
- Do not edit generated design-sheet outputs under `games/cameleon/design/` such as `copy.ts`, `tokens.css`, or `assets.ts`; only the hand-maintained provenance manifest `games/cameleon/design/asset-identity.json` is in scope.

### Deferred to Follow-Up Work

- Real-device seam and per-hide visual acceptance: later `Tested inSitu` / evidence stages must capture the iPhone/WebView runtime and compare against `games/cameleon/docs/pano-mock-v3.jpg`.
- Direction-specific riso/night panel generation: conductor follow-up after device proof replaces temporary poster-panel aliases.

---

## Context & Research

### Relevant Code and Patterns

- `games/cameleon/src/game/level.ts` parses level data and currently hard-codes `world.width === zoneWidth * 5` plus five panel keys per direction.
- `games/cameleon/src/game/CameleonController.ts` and `games/cameleon/src/game/hideState.ts` already preserve found state while switching direction-specific painted keys.
- `games/cameleon/src/game/phaserRuntime.ts` currently creates placeholder textures, adds panels only at scene creation, and draws decoys as rect outlines.
- `games/cameleon/src/game/query.ts` already accepts `?dir=poster|riso|night` and `?bodies=painted|white|off`.
- `games/cameleon/src/shell/CameleonScreen.ts` renders the HUD but has no direction selector control.
- `tools/cameleon-sign-lane-assets.mjs` deterministically renders sign-lane SVG and PNG assets but does not include `li-06` and currently rewrites `asset-identity.json` from its own generated entries.
- `games/cameleon/tests/unit/level-loader.test.ts`, `games/cameleon/tests/unit/sign-lane-assets.test.ts`, `games/cameleon/tests/unit/controller.test.ts`, `games/cameleon/tests/unit/hide-state.test.ts`, and `games/cameleon/tests/unit/smoke.test.ts` are the closest existing test patterns.

### Institutional Learnings

- `docs/testing-approach.md`, project AGENTS guidance, and `docs/plans/2026-07-06-001-tooling-verify-device-plan.md` all reinforce that mobile-game visual verification happens on the real device, not browser E2E.
- No `docs/solutions/` corpus exists in this worktree; relevant durable context is in `games/cameleon/docs/DESIGN.md`, `games/cameleon/docs/gen-ledger.md`, and the origin brainstorm.

### External References

- None. Local code and conductor-accepted assets are the source of truth for this plan.

---

## Key Technical Decisions

- Separate panel width from logical-zone mapping in code: `zoneWidth` stays aligned with the conductor's 1440 px panel geometry, while tour states and zone labels derive five logical zones across the 4320 px world.
- Use real asset keys with a static Cameleon registry: this keeps the change small, testable, and explicit without inventing a cross-game asset system.
- Extend deterministic asset authoring for `li-06`: it matches the sign-lane grammar and should remain zero-generation-cost, alpha-lockable, and source-backed by SVG.
- Derive missing organic direction variants locally: this satisfies per-direction painted-key resolution while preserving alpha masks and avoiding unapproved generation spend.
- Render seam covers and decoys as visual sprites, not hit targets: hit testing remains rectangle-based for hides/decoys only, and seam pillars do not become gameplay objects.
- Preserve temporary aliases as data, not runtime fallback: aliases must be visible to tests, provenance, and TODO comments so missing art is not masked by Phaser placeholders.

---

## Open Questions

### Resolved During Planning

- Should `zoneWidth` stay as panel width or become logical zone width? Use it as conductor panel width and introduce logical-zone mapping in code.
- How should manifest hides get widths when the manifest only gives `cx`, `cy`, and `h`? Use committed sprite dimensions to derive aspect-correct rect widths from the manifest height.
- Should organic riso/night hides alias poster or become local variants? Derive local variants where possible, with tests proving alpha identity across directions and white reveal.
- What is the smallest asset registry shape? A Cameleon-specific key-to-url registry with alias/provenance metadata and unit tests is sufficient.

### Deferred to Implementation

- Exact color-transfer parameters for derived organic riso/night sprites: choose during asset-script work, but preserve alpha exactly and document the derivation in provenance.
- Exact button sizing and CSS details for the direction control: fit the existing HUD/menu constraints and mobile safe area without changing gameplay flow.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
level.json asset keys
  -> Cameleon lido asset registry
  -> Phaser preload of panels, hides, decoys, seam covers
  -> scene sprites keyed by current snapshot direction
  -> controller state remains source of truth for found/scroll/mode/body state

asset scripts
  -> sign-lane SVG/PNG assets, including li-06
  -> one-shot lido-specific derived organic riso/night variants
  -> asset-identity provenance preserved and extended
  -> unit tests read level.json + registry + filesystem + provenance
```

---

## Implementation Units

- U1. **Update level schema for production geometry**

**Goal:** Let Cameleon parse the conductor binding geometry while keeping five logical gameplay zones.

**Requirements:** R1, R5; covers AE1.

**Dependencies:** None.

**Files:**
- Modify: `games/cameleon/src/game/level.ts`
- Modify: `games/cameleon/src/game/CameleonController.ts`
- Modify: `games/cameleon/tests/unit/level-loader.test.ts`
- Modify: `games/cameleon/tests/unit/controller.test.ts`

**Approach:**
- Remove the parser's old `world.width === zoneWidth * 5` constraint and replace the five-panel-count assertion with a three-panel expectation for lido production data.
- Add or reuse a helper that maps scroll/world x positions into the existing `CameleonZone` 1-5 conceptual zone set independently from panel width.
- Keep rect bounds validation, minimum hide size validation, hide/decoy id uniqueness, and `winAt` validation unchanged.
- Update controller tour-state and scroll tests so `zone1` through `zone5` remain reachable in a 4320 px world.

**Patterns to follow:**
- Existing parse validation style in `games/cameleon/src/game/level.ts`.
- Existing deterministic controller assertions in `games/cameleon/tests/unit/controller.test.ts`.

**Test scenarios:**
- Happy path: lido fixture parses with world width 4320, height 1440, `zoneWidth` 1440, and three panel keys for every direction.
- Edge case: world x positions across the compressed five logical zones map to `zone1` through `zone5`, including the far-right kiosk range.
- Error path: parser still rejects hide rects outside the world and hide rects below the minimum edge.
- Integration: controller scroll clamping still uses the full world width and reports `tourState: "zone5"` near the right edge.

**Verification:**
- The lido fixture can represent the accepted panel geometry without weakening existing hide and decoy validation.

---

- U2. **Generate missing sprite variants and preserve provenance**

**Goal:** Produce the missing `li-06` sign-lane sprite pair and direction-resolved organic variants without new image-generation spend.

**Requirements:** R2, R4, R5; covers AE3, AE5, AE7.

**Dependencies:** U1.

**Files:**
- Modify: `tools/cameleon-sign-lane-assets.mjs`
- Create or modify: `tools/cameleon-lido-asset-variants.mjs`
- Modify: `games/cameleon/package.json`
- Modify: `games/cameleon/design/asset-identity.json`
- Modify: `games/cameleon/tests/unit/sign-lane-assets.test.ts`

**Approach:**
- Add `li-06` to the sign-lane asset script using the same vector primitive style as the existing sign-family hides: red/white lane-rope beads with two oversized rounded beads as the tell.
- Ensure the sign-lane script preserves existing conductor-art provenance instead of overwriting top-level `conductor-art-v1` data.
- Add a one-shot, lido-specific deterministic variant-generation path for organic hides that creates riso/night painted sprites from accepted poster/white alpha inputs while preserving dimensions and alpha.
- Record derived assets with `generated:false`, `model:"derived"` or equivalent, zero cost, source relationship, date, and acceptance/spec notes in `asset-identity.json`.

**Patterns to follow:**
- Current vector primitive helpers and alpha-lock tests in `tools/cameleon-sign-lane-assets.mjs` and `games/cameleon/tests/unit/sign-lane-assets.test.ts`.
- Existing conductor-art provenance entries in `games/cameleon/design/asset-identity.json`.

**Test scenarios:**
- Happy path: `li-06` has poster/riso/night painted PNGs plus a white PNG and SVG source entries, all referenced by asset identity.
- Edge case: sign-lane asset regeneration keeps existing conductor panel and organic sprite provenance entries present.
- Integration: alpha comparison passes for `li-06` and organic derived variants across poster/riso/night/white.
- Error path: tests fail if a generated or derived lido asset lacks provenance fields needed by the card.

**Verification:**
- All direction-specific painted hide keys that level data will reference exist on disk and have matching alpha masks where required.

---

- U3. **Wire level data, asset keys, and completeness registry**

**Goal:** Update `level.json` and introduce a testable registry so every production key resolves intentionally.

**Requirements:** R1-R5; covers AE1, AE2, AE3, AE7 and prepares AE4 for later device evidence.

**Dependencies:** U1, U2.

**Files:**
- Modify: `games/cameleon/public/levels/lido/level.json`
- Modify: `games/cameleon/src/game/level.ts`
- Create: `games/cameleon/src/game/assets.ts`
- Create: `games/cameleon/tests/unit/lido-assets.test.ts`
- Modify: `games/cameleon/tests/unit/level-loader.test.ts`
- Modify: `games/cameleon/design/asset-identity.json`

**Approach:**
- Replace placeholder panel keys with stable production keys for three poster panels and explicit riso/night aliases to the poster panel files.
- Extend the level parser and interfaces with a required `spriteKey` on each decoy so decoys remain hittable gameplay objects but render from registered art.
- Extend the level parser and interfaces with a separate `visualOverlays` collection for non-hittable visual sprites such as seam covers, with overlay rects derived from accepted placement and sprite dimensions.
- Convert manifest `cx`, `cy`, and `h` values into rects for `li-01`, `li-03`, `li-04`, `li-05`, and `li-09` using the committed sprite aspect ratio.
- Keep sign-lane/host-prop hide rects aligned to the conductor note for `li-02`, `li-06`, `li-07`, `li-08`, and `li-10`.
- Replace the old outline-only decoy list with sprite-backed decoys made from the accepted manifest decoys plus the sign-lane prop/neighbor decoys needed for hide fairness.
- Build registry tests that walk level panel, hide, decoy, and seam keys across all directions and assert each resolves to an existing asset path or an explicitly documented temporary alias.

**Patterns to follow:**
- `games/cameleon/tests/unit/lidoFixture.ts` for fixture loading.
- Filesystem/provenance reading style in `games/cameleon/tests/unit/sign-lane-assets.test.ts`.

**Test scenarios:**
- Happy path: every `level.json` panel, hide, decoy, and seam key resolves through `games/cameleon/src/game/assets.ts` to a committed file.
- Happy path: poster panel keys resolve to `panel-a.png`, `panel-b.png`, and `panel-c.png` in order.
- Edge case: riso/night panel keys pass only because the registry marks them as temporary aliases to poster panels with a conductor-follow-up note.
- Error path: test fails if a level key depends on Phaser placeholder generation or points to a missing PNG.
- Integration: every resolved file path has asset-identity provenance either in the sign-lane `assets` map or the conductor-art provenance section.
- Integration: visual overlays are included in registry completeness but excluded from hit-test expectations.

**Verification:**
- Asset completeness can be checked headlessly before any runtime or device capture.

---

- U4. **Load and render real assets in Phaser**

**Goal:** Replace production placeholder rendering with real preloaded PNGs for panels, hides, decoys, and seam covers.

**Requirements:** R1, R2, R3, R5; covers AE6 and prepares AE4 for later device evidence.

**Dependencies:** U3.

**Files:**
- Modify: `games/cameleon/src/game/phaserRuntime.ts`
- Modify: `games/cameleon/src/game/assets.ts`
- Create: `games/cameleon/tests/unit/phaser-runtime-assets.test.ts`
- Modify: `games/cameleon/tests/unit/hide-state.test.ts`
- Modify: `games/cameleon/tests/unit/smoke.test.ts`

**Approach:**
- Use the registry to preload all assets needed by the lido level before scene creation.
- Expose a pure helper that returns the Phaser preload inputs for a level from the registry so unit tests can prove the runtime path uses registered PNGs.
- Render the three current-direction panel images across the world and update panel textures when direction changes.
- Render seam covers as visual sprites above panels and below gameplay hides, with no hit-test participation.
- Render decoys from sprite assets where the level data provides a key; keep hit testing based on authored decoy rects.
- Keep placeholder texture generation only as an explicit development fallback if needed by tests, never as the production path for registered lido keys.
- Update existing hide sprite texture switching so direction changes preserve found state, scroll position, and found count.

**Patterns to follow:**
- Existing `renderSnapshot` state update loop in `games/cameleon/src/game/phaserRuntime.ts`.
- Existing `hideObjectView` contract in `games/cameleon/src/game/hideState.ts`.

**Test scenarios:**
- Happy path: switching direction changes the painted hide keys while found hides remain found and white reveals remain visible.
- Happy path: a boot smoke test can construct the screen/controller with a non-poster direction and observe the selected direction in snapshot state.
- Edge case: `?bodies=white` and `?bodies=off` still control hide visibility after real keys replace generated placeholders.
- Integration: runtime preload-input tests include panels, hides, decoys, and visual overlays from the registry; no lido production key is absent from preload inputs.

**Verification:**
- Phaser runtime has a deterministic path from level asset keys to loaded textures and does not require placeholder textures for the accepted lido assets.

---

- U5. **Expose direction switching in the menu shell**

**Goal:** Provide a real menu control for `poster`, `riso`, and `night` direction selection while keeping `?dir=` initialization intact.

**Requirements:** R3, R5; covers AE6.

**Dependencies:** U4.

**Files:**
- Modify: `games/cameleon/src/shell/CameleonScreen.ts`
- Modify: `games/cameleon/src/shell/cameleon.css`
- Modify: `games/cameleon/src/main.ts`
- Modify: `games/cameleon/tests/unit/smoke.test.ts`
- Modify: `games/cameleon/tests/unit/controller.test.ts`

**Approach:**
- Extend `CameleonScreenOptions` with direction-change callbacks supplied by `bootGame`, keeping controller ownership in `main.ts`.
- Add a compact direction segmented control to the shell's menu/settings overlay area, anchored near the existing HUD and visible when the menu/settings state is active.
- Keep the HUD direction display as read-only status, and use the existing direction enum labels rather than editing generated design-sheet copy files.
- Preserve `parseCameleonQuery` behavior so URL initialization and menu changes use the same direction enum.
- Ensure direction changes emit `dir_selected` and do not reset found count, scroll, body mode, or play mode.

**Patterns to follow:**
- Existing DOM shell style in `games/cameleon/src/shell/CameleonScreen.ts`.
- Existing screen refresh and callback wiring patterns in `games/cameleon/src/main.ts`.

**Test scenarios:**
- Happy path: booting with `?dir=night` or equivalent query state initializes the controller and screen to night.
- Happy path: activating the menu direction control calls the controller path and updates the screen's displayed direction.
- Edge case: selecting the current direction is idempotent and does not emit duplicate state churn.
- Integration: switching direction after two hides are found preserves found count and hidden/found phases.

**Verification:**
- Both URL initialization and menu selection can reach all three directions without destabilizing an in-progress level.

---

## System-Wide Impact

- **Interaction graph:** `level.json` feeds parser, controller, registry, Phaser preload/rendering, tests, and later verify-device captures.
- **Error propagation:** missing production assets should fail unit tests or registry assertions before runtime; runtime should not silently mask missing registered keys with placeholders.
- **State lifecycle risks:** direction switching touches render textures only; controller hide state, scroll, ammo, and win progress remain authoritative.
- **API surface parity:** query params, controller setters, harness snapshots, and menu controls must agree on the same `poster|riso|night` enum.
- **Integration coverage:** filesystem/provenance tests are required because TypeScript alone cannot prove PNG availability or asset identity coverage.
- **Unchanged invariants:** hit testing remains rect-based, hide ids remain stable, `winAt` stays 8, and mobile device proof remains a later stage rather than a browser proxy.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `zoneWidth` name becomes ambiguous after the three-panel geometry change | Keep the conductor value in data, add logical-zone helpers/tests, and document the split in code comments only where it prevents misuse |
| Sign-lane script overwrites conductor-art provenance | Make preservation of existing non-sign-lane provenance an explicit test before regenerating assets |
| Derived organic direction variants look weaker than generated art | Preserve alpha and make their derived provenance explicit; defer visual acceptance to device/conductor evidence |
| Runtime still falls back to placeholders for a missing production key | Registry completeness tests fail missing keys and aliases before runtime |
| Seam covers accidentally become hit targets or hide objects | Model them as visual-only overlays and keep hit-test code unchanged |
| Browser render appears acceptable but device differs | Do not claim visual completion until later real-device capture/diff artifacts exist |
| One-shot derived-variant tooling grows into a reusable asset pipeline | Scope the helper to the finite Cameleon lido organic assets needed by this card |

---

## Documentation / Operational Notes

- Update TODO/provenance text near riso/night panel aliases so the conductor follow-up is discoverable by grep.
- If implementation adds a new asset-generation command for organic variants, document it alongside `assets:sign-lane` in `games/cameleon/package.json` scripts or `games/cameleon/README.md`.
- Later stage evidence should capture poster/riso/night direction changes, `?bodies=white`, 64 px seam-blend crops around x=1440 and x=2880, and representative hide reveal crops on the real device.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-07-08-cameleon-art-integration-requirements.md](../brainstorms/2026-07-08-cameleon-art-integration-requirements.md)
- Trello card: https://trello.com/c/cHf5RquT
- Accepted placement manifest: `games/cameleon/docs/placement-manifest.json`
- Visual target: `games/cameleon/docs/pano-mock-v3.jpg`
- Design binding: `games/cameleon/docs/DESIGN.md`
- Generation ledger: `games/cameleon/docs/gen-ledger.md`
- Current level fixture: `games/cameleon/public/levels/lido/level.json`
- Current parser/runtime: `games/cameleon/src/game/level.ts`, `games/cameleon/src/game/phaserRuntime.ts`
- Asset provenance: `games/cameleon/design/asset-identity.json`
- Asset generation: `tools/cameleon-sign-lane-assets.mjs`
- Unit test patterns: `games/cameleon/tests/unit/level-loader.test.ts`, `games/cameleon/tests/unit/sign-lane-assets.test.ts`, `games/cameleon/tests/unit/controller.test.ts`
