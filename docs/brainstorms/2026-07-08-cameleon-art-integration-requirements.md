---
date: 2026-07-08
topic: cameleon-art-integration
trello: https://trello.com/c/cHf5RquT
card: cHf5RquT
stage: brainstormed
status: requirements-locked
---

# Cameleon Art Integration Requirements

## Summary

Wire the conductor-accepted Sunwash Lido art into Cameleon so the live level uses the accepted three-panel poster panorama, hide sprite pairs, seam covers, and direction-specific asset keys instead of placeholder textures. The integration must preserve DESIGN.md's hidden-object fairness rules, make generated-asset provenance auditable, and leave the riso/night panel art gap explicit until the conductor generates those panels after device proof.

---

## Problem Frame

Cameleon currently has the playable lido scaffold, a 10-hide roster, query-driven `?dir=` direction support, and authored sign-lane sprites, but the runtime still synthesizes placeholder panels and generic hide silhouettes from `level.json`. The conductor has now accepted a concrete art manifest for the first production pass: `games/cameleon/docs/placement-manifest.json`, `games/cameleon/docs/pano-mock-v3.jpg`, three poster panels, five organic poster-painted/white hide pairs, generated decoys, and a seam-pillar overlay.

The accepted art also changes the level's physical geometry. The original design and current parser assume five 960 px zones in a 4800x1440 world. The accepted image-generation probe amended the binding geometry to a 4320x1440 world composed of three 1440x1440 square panels. If implementation only changes JSON keys, it will collide with current parser/runtime assumptions that `world.width === zoneWidth * 5` and that each direction has five panel keys. The next stage needs to treat art integration as a data-model and asset-resolution pass, not a cosmetic file swap.

---

## Assumptions

*This requirements doc was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input - un-validated bets that should be reviewed before planning proceeds.*

- The conductor comment on 2026-07-08 is the acceptance gate for this card; no further art-generation acceptance is needed before planning starts.
- The five hide zones remain gameplay/read-order metadata even though the physical background is now three square panels.
- Temporary poster-panel aliases for riso/night are allowed only for zone panels because the conductor explicitly named that exception; hide-sprite aliases across directions should be avoided unless planning records a separate rationale.
- The existing Cameleon runtime's generated placeholder textures are development fallbacks, not acceptable production bindings for this card's accepted art.

---

## Actors

- A1. Player: scrolls the lido on a phone, changes direction/mode from the menu or query string, and finds at least 8 of 10 hides.
- A2. Planning/implementation worker: updates level data, asset resolution, tests, and provenance on this branch.
- A3. Conductor/reviewer: validates that the accepted art is preserved on device and that temporary gaps are named honestly.
- A4. Cameleon runtime: loads panel, hide, decoy, and seam textures by stable asset key and renders the selected direction.
- A5. Audit/test runner: verifies that level asset keys resolve, alpha-lock expectations hold, and generated assets have provenance.

---

## Key Flows

- F1. Poster Pop production render
  - **Trigger:** The player starts the lido with default settings or `?dir=poster`.
  - **Actors:** A1, A4.
  - **Steps:** The runtime loads three accepted poster panel images, places them across the 4320x1440 world, overlays seam pillars at the conductor-specified seams, renders all hide and decoy sprites at world-space coordinates, and preserves scroll/hit-test behavior.
  - **Outcome:** The live level visually matches the accepted `pano-mock-v3` composition closely enough for device proof and seam review.
  - **Covered by:** R1-R10, R18-R22.

- F2. Direction selection
  - **Trigger:** The player selects a visual direction in the menu or uses `?dir=poster|riso|night`.
  - **Actors:** A1, A4.
  - **Steps:** The controller stores the selected direction, asset lookup resolves the direction's panel and painted-hide keys, white reveal sprites remain shared, and analytics continue to record `dir_selected`.
  - **Outcome:** Direction changes are visible and all selected-direction keys resolve; temporary riso/night panel aliases are explicit and do not mask missing assets.
  - **Covered by:** R11-R15, R19-R21.

- F3. Found/reveal integrity
  - **Trigger:** The player taps or confirms a hidden body.
  - **Actors:** A1, A4, A5.
  - **Steps:** The hitbox matches the accepted hide placement, the painted sprite reveals to the white sprite with the same alpha silhouette, and sign-lane/organic hides obey the one-fair-tell design.
  - **Outcome:** The accepted painted state first reads as an object or printed figure, while the white state reads as the doughboy body in the same silhouette.
  - **Covered by:** R4-R9, R16, R18, R22.

---

## Requirements

**Binding geometry and panels**
- R1. `games/cameleon/public/levels/lido/level.json` must represent the conductor binding geometry: world width 4320, height 1440, panel width/`zoneWidth` 1440, and three panel keys per direction.
- R2. Parser and runtime assumptions that require `world.width === zoneWidth * 5` or five panel keys per direction must be updated with unit coverage rather than worked around in data.
- R3. Poster direction panel keys must resolve to `public/levels/lido/panels/poster/panel-a.png`, `panel-b.png`, and `panel-c.png` in left-to-right order.
- R4. Riso and night direction panel keys may temporarily resolve to the poster panel images only with a code or data TODO that names the conductor follow-up: riso/night panels are generated after device proof.
- R5. Seam-pillar overlays must render at x=1440 and x=2880, centered at y=505 with height 1010, using `seam-pillar-deck`, without changing hide hitboxes or becoming tappable decoys.
- R6. The implementation must preserve the 64 px seam-blend review intent from DESIGN.md section 9 and make the seam check observable in later aesthetics/device evidence.

**Hide placement and sprite identity**
- R7. Hides in `placement-manifest.json` (`li-01`, `li-03`, `li-04`, `li-05`, `li-09`) must use the manifest's world-space `cx`, `cy`, and `h` values to derive `level.json` rectangles that fit the 4320x1440 world and preserve the minimum hide size rule.
- R8. Sign-lane/host-prop hides must be composed onto their specified props: `li-02` on the yellow warning panel in panel A, `li-06` as the lane-rope segment continuing panel B's rope line around y=1140, `li-07` as the fifth swim-school poster figure on panel B, `li-08` on the wet-floor A-frame at the tower base, and `li-10` as the mascot-panel pair on the kiosk front.
- R9. `li-06` must be authored in the same deterministic sign-lane script style as the other flat printed assets: red/white pill beads, with two oversized rounded beads as the head/hip tell.
- R10. Every hide must keep a painted/white sprite-pair contract where the white reveal shares the painted alpha silhouette; per-direction painted variants must share alpha with the white reveal.
- R11. Every `spritePair.painted[poster|riso|night]` key in `level.json` must resolve to an asset for that direction. If a direction-specific organic hide asset is missing, planning must derive an acceptable variant or document a temporary alias explicitly; silent missing texture fallback is not acceptable.
- R12. Decoys from the accepted manifest must remain present where they support the fairness grammar: tent, robe, bodyprint towel, ringstack, and sign-lane decoys.

**Asset registry and runtime binding**
- R13. The runtime must load or register real PNG textures for level panels, hides, decoys, and seam covers by the stable `level.json` asset keys instead of relying on generated placeholder textures for the production path.
- R14. Direction changes must re-render panels and painted hide sprites for the selected direction without losing current hide state, scroll position, or found count.
- R15. Menu UI must expose the three visual directions, and `?dir=poster|riso|night` must continue to initialize the selected direction.
- R16. `?bodies=painted|white|off` must continue to work after real assets land so QA can compare painted disguises against white bodies at phone scale.

**Provenance and generated-asset accounting**
- R17. `games/cameleon/design/asset-identity.json` must include provenance for every accepted conductor asset used by this integration, including whether it is generated, model or derived/authored source, date, estimated cost, spec, and acceptance note.
- R18. Generated assets must not be duplicated into misleading direction entries. Temporary aliases should point to the same underlying asset identity and name the pending conductor art where relevant.
- R19. The image-generation ledger in `games/cameleon/docs/gen-ledger.md` remains the spend source of truth; this card must not hide new generation spend outside that ledger.

**Verification gates**
- R20. Unit tests must prove the lido fixture loads with the 4320x1440 / three-panel geometry and that every level asset key resolves for all three directions.
- R21. Unit tests must cover asset-manifest completeness for lido production keys, including panels, hide sprites, decoys, seam covers, and temporary direction aliases.
- R22. Alpha-lock tests must include the new `li-06` lane-rope hide and any organic per-direction variants or aliases introduced by this card.
- R23. The local close-out checks for the implementation stage are `npm run typecheck -w @fabrikav2/cameleon`, `npm run test:unit -w @fabrikav2/cameleon`, `npx eslint .`, and `npm run audit`.
- R24. Because this is a mobile game, visual/runtime completion remains unverified until later device-stage evidence captures the level on the real phone/WebView. Browser E2E is not a substitute for that evidence.

---

## Acceptance Examples

- AE1. **Covers R1-R4, R13, R20.** Given `level.json` names three poster panel keys, when the lido fixture is parsed and the production asset registry is checked, the fixture reports a 4320x1440 world and all three poster keys resolve to existing poster panel PNGs.
- AE2. **Covers R4, R11, R18, R21.** Given riso/night panel art has not been generated yet, when the asset completeness test runs, it passes only if the riso/night panel keys deliberately alias the poster panels and the alias is documented as a conductor-approved temporary state.
- AE3. **Covers R7, R10, R16, R22.** Given a manifest-placed organic hide such as `li-05`, when QA switches between `?bodies=painted` and `?bodies=white`, the white body appears in the same world rect and alpha silhouette as the painted disguise.
- AE4. **Covers R5, R6.** Given the poster panorama is rendered on device, when frames are reviewed around x=1440 and x=2880, the seam-pillar covers align with the panel joins and do not create visible discontinuities across the 64 px overlap zones.
- AE5. **Covers R8, R9, R22.** Given the new `li-06` lane-rope sprite is generated by the sign-lane script, when the alpha-lock unit test reads poster/riso/night/white PNGs, all variants have identical alpha dimensions and masks.
- AE6. **Covers R14, R15.** Given the level is in progress with two hides already found, when the player switches direction from the menu, the HUD direction changes, panels/painted sprites update, and found state remains unchanged.
- AE7. **Covers R17-R19, R21, R23.** Given all accepted assets are wired, when `npm run audit` and lido asset-manifest tests run, they fail on any production asset key that lacks asset identity provenance or references an untracked generated asset.

---

## Success Criteria

- The lido no longer renders as placeholder colored zones: Poster Pop uses the accepted conductor art and production asset keys.
- Planning can implement the geometry shift without inventing product behavior or missing the parser/runtime assumptions that currently enforce five 960 px zones.
- Every hide and decoy has a stable, reviewable production asset identity, and every direction either resolves to real direction art or an explicitly documented temporary alias.
- The next visual/device stages have concrete seam, alpha-lock, direction, and placement evidence targets instead of a vague "looks wired" check.

---

## Scope Boundaries

- Do not generate the missing riso/night panel art in this card; the conductor explicitly owns that after device proof.
- Do not redesign the hide roster, difficulty curve, found beat, or win-at-8 rule from `games/cameleon/docs/DESIGN.md`.
- Do not treat desktop browser screenshots or Playwright browser E2E as mobile-game verification.
- Do not open a pull request as part of the twf worker flow; the conductor owns branch integration.
- Do not edit generated design-sheet outputs under `games/cameleon/design/` except the hand-maintained `asset-identity.json` provenance file.

---

## Key Decisions

- Use the conductor's accepted art manifest as binding input, not a fresh design prompt.
- Treat the 4320x1440 / three-panel change as a real schema/runtime requirement because current code enforces the old five-panel shape.
- Keep riso/night panel aliases honest and temporary; the visual directions still need key coverage now, but they should not be represented as finished generated panel art.
- Extend the deterministic sign-lane asset path for `li-06` because the lane-rope hide is flat, graphic, and better served by authored beads than by another image-generation pass.

---

## Dependencies / Assumptions

- Binding design: `games/cameleon/docs/DESIGN.md`, especially sections 4, 8, 9, and 9b.
- Accepted art inputs: `games/cameleon/docs/placement-manifest.json` and `games/cameleon/docs/pano-mock-v3.jpg`.
- Current level data: `games/cameleon/public/levels/lido/level.json`.
- Runtime/data code that planning must inspect: `games/cameleon/src/game/level.ts`, `games/cameleon/src/game/phaserRuntime.ts`, `games/cameleon/src/game/query.ts`, and `games/cameleon/src/shell/CameleonScreen.ts`.
- Existing provenance and tests: `games/cameleon/design/asset-identity.json`, `games/cameleon/tests/unit/level-loader.test.ts`, and `games/cameleon/tests/unit/sign-lane-assets.test.ts`.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1-R2][Technical] Should the existing `zoneWidth` field be reinterpreted as panel width for Cameleon, or should planning add a distinct panel-width field while preserving logical five-zone metadata?
- [Affects R7][Technical] What exact rect width should each manifest hide use when only `cx`, `cy`, and `h` are provided: measured PNG aspect ratio, manifest-side convention, or design-authored per-hide width?
- [Affects R11, R22][Technical] For organic hides that currently have poster-painted and white assets only, should riso/night be derived deterministically from the poster alpha or temporarily aliased with an explicit risk note?
- [Affects R13, R21][Technical] What is the smallest asset registry shape that lets tests prove every `level.json` key resolves without overbuilding a general asset pipeline?
