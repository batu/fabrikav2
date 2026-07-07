---
title: "marble_run menu board rotation fidelity"
date: 2026-07-07
topic: marble-run-menu-board-rotation
trello: https://trello.com/c/cHdg4uiV
card: cHdg4uiV
stage: brainstormed
status: requirements-locked
---

# marble_run menu board rotation fidelity - requirements

## Summary

This card narrows the menu fidelity work to the board-and-saga composition:
rotate the decorative menu board to the reference tilt, reduce its footprint,
and move the saga chain into clear space below it with the current level reading
as the large sunburst medallion.

---

## Problem Frame

Batu explicitly confirmed that the reference menu's tilted board is desired, not
a bug. The current device capture still shows the menu board upright, oversized,
and placed directly under the banner, with saga medallions drawn on top of the
board. That makes the level map compete with the decorative board instead of
forming the clear vertical progression visible in the Android reference.

Grounding evidence:
- Reference: `games/marble_run/refs/captures/android-basegamelab/menu.png`
- Current device capture: `docs/evidence/2026-07-07-1800-turn5-verify/raw-captures/menu.png`
- Latest panel: `docs/evidence/2026-07-07-1800-turn5-verify/panel.json` reports menu fidelity `55` and consensus layout findings that the board is flat/upright, too high, and overlapping other elements.

---

## Mobile Game UI/UX Audit

MOBILE GAME UI/UX AUDIT - marble_run menu board + saga

- First 30 seconds: 3/5 - the menu is recognizable and has a primary Level CTA, but the board/nodes composition muddies the player's "where am I?" read.
- Touch ergonomics: 4/5 - primary CTA and current node are large; remaining risk is overlap making node intent ambiguous.
- HUD readability: 4/5 - top chrome is readable; this card does not touch in-level HUD.
- Gameplay focus: 2/5 - decorative board competes with the level map because saga nodes sit on top of it.
- Feedback: 3/5 - existing taps are wired, but this visual card does not add new feedback.
- Flow momentum: 3/5 - current level is present, but the path reads cluttered and less deliberate than the reference.
- Responsive canvas: 2/5 - the current on-device menu composition does not reserve enough vertical space for board plus saga.
- Evidence: 4/5 - existing proof is real-device capture and panel output; final close-out still needs a post-fix `verify-device` panel run.

Priority fixes:
1. Rotate and shrink the menu board to match the reference tray silhouette.
2. Reserve clear space below the board and move every saga node out of the board footprint.
3. Preserve / enforce the current-level sunburst medallion as the visual anchor above the Level CTA.

---

## Assumptions

*This requirements doc was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input - un-validated bets that should be reviewed before planning proceeds.*

- The current saved level / coin numbers in captures are test-state noise; this card should not normalize save data or level progression.
- "Rotate/tilt" means a visible clockwise tray angle comparable to the reference, roughly 15 degrees, while preserving board readability and non-interactive decorative behavior.
- "Shrink it" means reducing the menu board's visual footprint enough that no saga node intersects the board or banner on the target phone capture.
- The saga chain may stay centered rather than zig-zagging if that better matches the latest accepted design direction, but the overlap must be eliminated and the current node must stay visually dominant.

---

## Actors

- A1. Player: lands on the menu, reads the current level, and taps the primary level CTA or current saga node.
- A2. Batu / reviewer: compares the on-device menu against the Android reference capture.
- A3. Pipeline worker: implements and verifies the fix in the real mobile target.

---

## Key Flows

- F1. Menu arrival
  - **Trigger:** The game boots or returns to the menu.
  - **Actors:** A1, A2
  - **Steps:** The top chrome and banner render first, the decorative board appears below the banner as a tilted tray, the saga chain starts below the board, and the current sunburst medallion leads into the green level CTA.
  - **Outcome:** The player can distinguish the board decoration from the level progression without any node overlap.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7

- F2. Level selection
  - **Trigger:** The player taps the current saga node or the Level CTA.
  - **Actors:** A1
  - **Steps:** The current node remains tappable and visually primary; locked or ahead nodes remain non-primary; tapping the current level starts play.
  - **Outcome:** The layout fix does not regress real menu input.
  - **Covered by:** R5, R6, R8

---

## Requirements

**Board Composition**
- R1. The decorative menu board must render with a clear rotated tray angle that matches the reference direction and approximate magnitude, instead of appearing upright.
- R2. The menu board must be smaller than the current device capture and leave visible purple background between the board and the saga/current-level path.
- R3. The board must sit below the banner without colliding with top chrome, the title banner, or the saga chain.
- R4. The board remains decorative in menu mode; this card must not change puzzle rules, level content, scoring, or in-level board camera behavior.

**Saga Layout**
- R5. Saga medallions must move clear below the board; no locked, completed, or current node may overlap the board in the target menu capture.
- R6. The current level medallion must render as the large gold sunburst node and remain the strongest level-map focal point.
- R7. The lower chain must preserve a readable progression from future/locked nodes toward the current node and the primary Level CTA.

**Verification**
- R8. The worked-stage implementation must include an automated guard for the menu geometry that catches board/node overlap or a missing current sunburst state before device close-out.
- R9. Close-out for the full card requires `verify-device` panel evidence on the real device, with the menu state captured and compared against the reference.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R5.** Given the menu is captured on the target phone, when the reviewer compares it with `refs/captures/android-basegamelab/menu.png`, the board is visibly tilted, smaller than the current upright capture, and every saga medallion is outside the board rectangle.
- AE2. **Covers R6, R7.** Given the saved current level is any unlocked level, when the menu renders, the current level is the large gold sunburst medallion nearest the Level CTA, while neighboring nodes remain smaller wood medallions.
- AE3. **Covers R8, R9.** Given a future worker changes menu geometry, when tests and `verify-device` run, local geometry checks catch obvious overlap and the final device panel supplies the authoritative visual proof.

---

## Success Criteria

- The menu board reads as a tilted tray similar to the reference, not an upright gameplay board.
- Saga nodes no longer cover the board; the chain has a clear reserved lane below the board.
- The current-level sunburst is visually dominant and still maps to the playable current level.
- The next worker can plan and implement without rediscovering the intended rotation or the device evidence that motivated it.

---

## Scope Boundaries

- Do not change gameplay mechanics, generated levels, solver behavior, rewards, save progression, or in-level HUD/camera behavior.
- Do not rebuild the whole menu, settings modal, result card, or background system as part of this narrow card.
- Do not add a desktop-only visual convergence path; phone/device capture remains the close-out target.
- Do not open a pull request from this worker; the pipeline conductor owns branch merge.

---

## Key Decisions

- Rotate the board rather than straighten it: Batu explicitly confirmed the tilted reference board is the desired direction.
- Keep the work scoped to menu board plus saga geometry: the broader fidelity backlog has other menu and settings issues, but this card is about board rotation, size, and overlap.
- Treat the current sunburst as required, not optional decoration: it is the player's strongest location cue and part of the reference composition.

---

## Dependencies / Assumptions

- Relevant implementation surfaces observed in this worktree include `games/marble_run/src/game/GameController.ts` for the decorative menu board framing, `games/marble_run/src/shell/saga.ts` for menu saga windowing, `packages/ui/src/SagaMap.ts` and `packages/ui/src/ui.css` for node layout/state styling, `games/marble_run/design/theme.ts` for level-node art wiring, and `games/marble_run/design/tokens.css` for game-specific level-map tokens.
- `games/marble_run/src/shell/saga-layout.test.ts` currently encodes a straight-line topology expectation. Planning must decide whether to update that guard, replace it with a no-overlap/sunburst geometry guard, or keep it while moving the straight line lower.
- The latest available device evidence already comes from the real target lane; a desktop browser screenshot is not sufficient to close the full card.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R2][Technical] Which layer should own the visual board tilt: the Three.js decorative board camera/framing, a menu-only transform around the canvas composition, or a smaller staged decor scene?
- [Affects R5, R8][Technical] What is the smallest robust automated guard for "nodes clear below board" given one surface is Three.js canvas and the other is DOM?
- [Affects R6][Technical] Is the current sunburst already fully driven by `level-node-current.webp`, or does the CSS scale/art sizing need an explicit state-specific guard?
