# Fidelity re-run evidence (marble_run) — harness-produced

Card **KEghp3x4 §1 (USE)**. The v1-vs-v2 fidelity comparison re-run through the
testkit (`SharedShellDriver` + `capture()` + `collectRun()`) instead of the
earlier hand scripts. See `fidelity-grid.html` for the before/after grid.

## Provenance

- **v1 (left)**: real Android device captures (Pixel 6a, adb lane), shipped in
  `games/marble_run/refs/captures/android-basegamelab/`, copied into `refs/` here
  so the grid is self-contained.
- **v2 (right)**: Chromium/browser captures (Playwright viewport 405×900) from a
  single continuous harness session. The settings state is reached by a REAL gear
  click through `SharedShellDriver.openSettings()` (dead-button-safe), not a harness jump.
- On-device v2 capture is NOT used (unwired stub `captureToDeviceDocuments`).

## Paired states

- `menu`
- `settings`
- `level-start`
- `level-mid`

## Run witnesses

- `screenshots/menu.png`
- `screenshots/settings.png`
- `screenshots/level-start.png`
- `screenshots/level-start-canvas-witness.png`
- `screenshots/level-mid.png`
- `snapshots.json` — stamped snapshot envelopes.
- `events.json` — analytics trace (2 events).
- `perf.json` — frame-time buckets (165 frames, worst 851.1ms).
- `manifest.json` — run index.
