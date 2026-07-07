# Tap Ten — design brief

This brief is the reskin contract for the second v2 scaffold proof.

## What it is
Tap Ten is a single-screen reflex mini game. A two-by-two board lights one tile
at a time; the player wins by tapping ten lit tiles and fails after three wrong
taps. The deterministic harness solver follows the same rules: `winLevel()`
taps the lit tile, and `failLevel()` taps the next wrong tile.

## Feel
Clear, quick, readable, and deliberately modest. The visual layer should feel
like a compact arcade panel, not a content-heavy puzzle game.

## Constraints
This game is a platform proof, so gameplay depth is out of scope. Keep the
canonical six states (`menu`, `level`, `settings`, `pause`, `win`, `fail`), the
design-owned copy/tokens/assets layer, and the full test harness surface intact.
Full real-device verification is a follow-up.
