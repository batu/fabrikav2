# Marble Run editor scroll affordances

## Task 1 — Make overflow visible

- Status: passed
- Goal: Every overflowing editor surface has a visible scrollbar without adding navigation or repeated content.
- Pre-shot targets: Pattern, Ranges, and Boards at 1440 × 900; Ranges and Boards at 760 × 900.
- Acceptance criteria:
  - The document shows a persistent vertical track whenever the current view exceeds the viewport.
  - Ranges and Boards show a persistent horizontal track whenever their content exceeds the available width.
  - Non-overflowing axes show no false affordance.
  - Existing layout, selection, and board-play behavior remain unchanged.
- Constraints: CSS-only visual correction; no new controls, labels, or navigation.
- Out of scope: restructuring the Journey views or changing the authored difficulty model.
