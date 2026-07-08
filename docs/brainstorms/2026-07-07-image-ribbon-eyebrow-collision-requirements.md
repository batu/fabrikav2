---
title: "MICRO-2 image-ribbon eyebrow collision requirements"
date: 2026-07-07
trello: https://trello.com/c/wBSWpLmW
card: wBSWpLmW
stage: todo -> brainstormed
status: requirements-locked
---

# MICRO-2 image-ribbon eyebrow collision requirements

## Summary

Fix the result-card image-ribbon variant so the live level eyebrow sits as its own
readable line above the baked `COMPLETED` / `FAILED` title art. The fix must prove the
actual image-sprite path, preserve existing non-image and settings-ribbon behavior, and
close with a real device crop of the affected result header.

---

## Problem Frame

The first attempt targeted the non-image ribbon path and landed green, but the conductor's
device crops did not change. The remaining collision is in the image-ribbon path used by
Marble Run result cards: the ribbon sprite already contains the large title text, while
the live `LEVEL 4` eyebrow is still stacked in the same centered image-ribbon area. On
device, that places the eyebrow under or into the baked `COMPLETED` / `FAILED` lettering
instead of above it.

The relevant product target is visible in the reference crops:

- `games/marble_run/refs/captures/android-basegamelab/win-ref.png`
- `games/marble_run/refs/captures/android-basegamelab/fail-ref.png`

This is a small visual bug, but it is easy to falsely verify because DOM/unit tests can
exercise the plain color-ribbon variant and miss the bound-sprite variant that the game
actually renders.

---

## Assumptions

*This requirements doc was authored without synchronous user confirmation. The items below
are agent inferences that fill gaps in the input - un-validated bets that should be
reviewed before planning proceeds.*

- The level eyebrow remains live DOM text; it should not be removed, hidden, or baked into
  the sprite assets as part of this card.
- The image-ribbon title for result cards continues to be supplied by the sprite art, with
  the live title kept for dialog labelling rather than doubled visually.
- The close-out crop is expected from the Marble Run result-card flow, not a package-only
  fixture that never binds the real game sprites.

---

## Actors

- A1. Mobile player: Sees win/fail result cards and must read the level marker without it
  colliding with the result title.
- A2. Implementation worker: Changes the UI stack and test coverage without widening the
  result-card scope.
- A3. Pipeline verifier: Checks image-variant proof and device evidence before the card
  moves beyond implementation/testing.

---

## Key Flows

- F1. Win result card renders with a bound sprite
  - **Trigger:** Marble Run reaches a completed level and shows the result card.
  - **Actors:** A1, A2, A3
  - **Steps:** The game mounts `ResultCard` with a win variant, a `ribbonImage`, a title
    such as `COMPLETED`, and an eyebrow such as `LEVEL 4`; the image-ribbon layout places
    the eyebrow in the upper ribbon band; the sprite title remains readable below it.
  - **Outcome:** The header reads as `LEVEL 4` above `COMPLETED`, with no visible collision.
  - **Covered by:** R1, R2, R5, R6, R7

- F2. Fail result card renders with a bound sprite
  - **Trigger:** Marble Run reaches a failed level and shows the result card.
  - **Actors:** A1, A2, A3
  - **Steps:** The game mounts `ResultCard` with a fail variant, a `ribbonImage`, a title
    such as `FAILED`, and an eyebrow such as `LEVEL 4`; the same image-ribbon layout keeps
    the eyebrow above the baked fail title.
  - **Outcome:** The header reads as `LEVEL 4` above `FAILED`, with no visible collision.
  - **Covered by:** R1, R3, R5, R6, R7

---

## Requirements

**Image-ribbon behavior**
- R1. The fix must target the `ResultCard` / `ModalShell` image-ribbon variant where a
  caller supplies both a ribbon sprite and an eyebrow.
- R2. In the win image-ribbon variant, the eyebrow must render as a distinct line above
  the baked `COMPLETED` title art and must not overlap or sit under that title.
- R3. In the fail image-ribbon variant, the eyebrow must render as a distinct line above
  the baked `FAILED` title art and must not overlap or sit under that title.
- R4. The fix must preserve non-image ribbon behavior: plain tone ribbons with live title
  and eyebrow should continue to lay out as before.
- R5. The fix must preserve the image-ribbon accessibility contract: the sprite remains
  decorative, and the dialog remains labelled by the live title even when the sprite
  carries the visible title art.

**Regression coverage**
- R6. Automated coverage must prove the image variant, not only the plain tone variant:
  the exercised result card must have a bound sprite image, the image-ribbon modifier, and
  an eyebrow.
- R7. Visual close-out must include a real-device crop of the affected result-card header
  for the Marble Run win and/or fail image-ribbon path. A desktop browser screenshot,
  package unit test, or non-image ribbon assertion is not enough to call the visual fix
  done.
- R8. The implementation footprint should stay limited to the shared UI result/modal
  ribbon stack and the narrow game/test surfaces needed to prove Marble Run binds that
  image variant.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5, R6.** Given a completed Marble Run level that mounts a win
  result card with `ribbonImage` and `eyebrow: "LEVEL 4"`, when the result header is
  captured, the eyebrow appears above the baked `COMPLETED` lettering and both lines are
  readable.
- AE2. **Covers R1, R3, R5, R6.** Given a failed Marble Run level that mounts a fail
  result card with `ribbonImage` and `eyebrow: "LEVEL 4"`, when the result header is
  captured, the eyebrow appears above the baked `FAILED` lettering and both lines are
  readable.
- AE3. **Covers R4, R5.** Given a settings-style image ribbon that intentionally keeps the
  live title visible, when the modal renders, the title visibility behavior is unchanged.
- AE4. **Covers R6, R7.** Given an automated test that mounts only a plain color ribbon or
  asserts only that the DOM contains `LEVEL 4`, when the card is reviewed, that test is
  insufficient evidence for this bug because it does not observe the image-ribbon collision
  surface.

---

## Success Criteria

- The affected result-card header matches the reference composition: `LEVEL 4` is visibly
  above the result title, not hidden under it or centered through it.
- The next worker can point to an automated assertion that explicitly exercises the
  image-ribbon variant and to a device crop that shows the visible fix in Marble Run.
- Existing package-level expectations for transparent image ribbons, settings visible-title
  ribbons, and non-image tone ribbons remain intact.

---

## Scope Boundaries

- Do not redesign the result modal, reward content, buttons, backplate, scrim, or win/fail
  flow.
- Do not replace or rebake the reference sprite assets unless planning discovers the assets
  themselves are wrong; this card is scoped to the stack/layout collision called out by the
  conductor.
- Do not treat desktop-only Playwright evidence as final visual verification for the mobile
  game close-out.
- Do not open a pull request from this worker stage; the TWF conductor handles branch
  merging later in the pipeline.

---

## Key Decisions

- Target the image-ribbon stack directly: the prior non-image fix did not move device
  pixels, so the image variant is the source of truth for this card.
- Keep the eyebrow as a separate visible line above the title area: this matches the
  reference crops and keeps level identity readable without duplicating title text.
- Make verification image-aware: the critical regression is not DOM presence, but the
  relationship between live eyebrow text and sprite-carried title art.

---

## Dependencies / Assumptions

- Marble Run currently binds result-card ribbon sprites from `games/marble_run/design`
  assets and passes the level eyebrow from the result flow.
- `packages/ui/src/ui.css`, `packages/ui/src/ModalShell.ts`, and
  `packages/ui/src/ResultCard.ts` are the shared surfaces most likely to be relevant, with
  existing coverage in `packages/ui/src/ModalShell.test.ts` and
  `packages/ui/src/ResultCard.test.ts`.
- Game-level proof will likely involve `games/marble_run/tests/e2e` and the existing
  reference capture set under `games/marble_run/refs/captures/android-basegamelab`.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R6][Technical] Choose the narrow automated assertion that best proves no overlap
  in the image variant: DOM geometry, pixel crop comparison, or a paired screenshot
  assertion. It must fail on the current centered image-ribbon stack.
- [Affects R7][Device evidence] Choose whether the device close-out should capture both win
  and fail headers or one representative header plus automated coverage for the other.
