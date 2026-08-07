# Settings polish task pack

Status: active

Goal: Correct the menu and in-game settings geometry reported on the physical phone.

Acceptance criteria:

1. Music, Sound Effects, and Haptics labels have a deliberate inner inset instead of hugging the row edge.
2. The in-game Restart action has visible separation from the toggle panel above it.
3. All three switches use the established Marble Run 78 x 42 track and 34px thumb geometry.
4. The settings ribbon spans nearly the full phone width and remains fully visible below the top safe area.

Capture targets: menu settings and in-game settings at 390 x 844 CSS pixels.

Constraints: preserve the existing card, copy, actions, colors, settings behavior, and result modals.

Verification: matching before/after screenshots, DOM geometry measurements, focused CSS tests, full unit suite, typecheck, lint, web build, and an installed non-launched iPhone build.
