# Post-fix fidelity re-verify — marble_run (card MR6uIsba)

Re-runs the 38-finding [rigorous paired diff](../2026-07-06-1747-rigorous-diff/report.html)
**after** the fidelity fixes landed (overlays / saga STRAIGHT-LINE topology / asset
swaps / accent-green theme / render-binding) plus the `driveTo` harness and
`refcap-compare`.

## Artifacts

- **`report.html`** — the resolved / remaining table over all 38 findings (F01–F31,
  N1–N7), each row citing its source finding id, with honest `NEEDS-VIDEO` /
  `NEEDS-DEVICE` / `NEEDS-CAPTURE` / `UNVERIFIED` marks. **Start here.**
- **`grid.html`** — paired **android reference | v2** grid, one row per canonical
  state, with a perceptual pixel-diff thumbnail. Built via refcap-compare's own
  grid module. Self-contained (images base64-inlined).
- **`integrity.json`** — the capture-integrity ledger: for every state, `driveTo()`
  return + the confirmed live `snapshot()` scene. This is the N1/B5 anti-mislabel gate.
- **`shots/*.png`** — the six recaptured v2 states (menu, level, settings, pause, win, fail).
- **`capture-postfix.mjs`** / **`build-report.mjs`** — the (re-runnable) capture and
  report generators. Analysis scripts; they touch no game/package/tool source.

## Method (honest)

- **v2 lane** = `vite dev` (test harness enabled in dev mode) driven by Playwright
  Chromium at **390×844** (deviceScaleFactor 2). Navigation is
  `window.__MARBLE_RUN_HARNESS__.driveTo(state)`; **every** screenshot is saved only
  when `driveTo()===true` **and** the live `snapshot()` reports the expected
  scene/flag (`menu` / `playing` / `settingsOpen` / `paused` / `complete` / `failed`).
  Each state is captured from a fresh cold reload — no cross-state DOM leak. This is
  what makes the "menu mislabeled as level/pause" bug (B5 / finding N1) impossible here.
- **reference lane** = the committed OFFLINE android captures
  (`games/marble_run/refs/captures/android-basegamelab/*.png`, Pixel 6a adb).
- A browser (WKWebView-family) capture is sufficient for **asset / color / layout**
  fidelity. **Motion** (animated bg, red glare, particle clash) and **native-shell**
  items (safe-area, status-bar tint) and **app-icon** are marked, never asserted from a still.

## Headline (see `report.html` for the full cited table)

- **17 clearly good** — 15 `RESOLVED` + 2 `POSITIVE (kept)`. The big wins: the shared
  OverlayCard regression (N2/N3) — win now has a green **COMPLETED** ribbon + gold
  **crown** + green **NEXT** (F25/F27/F29); fail now has a red **FAILED** ribbon + green
  **WATCH AD** (F31 banner/accent); straight-line saga (F02); gold coins & drawn hearts
  & warm HINT tile in-level (F08/F13/F14/F15); green settings toggles (F21); settings is
  now a modal (F18).
- **9 PARTIAL** — root fixed, a named slice remains (e.g. F04 board still large & chain
  runs through it; F26 dimmed-board scrim still absent; F22 settings card still cream
  while win/fail migrated to blue candy).
- **5 STILL-OPEN** — F06 flat-dots bg, F20 settings-header font, F22 settings card,
  F30 win coin placement, N4 extra Replay link.
- **2 NEEDS-VIDEO** (F07 animated bg, F16 red glare), **2 NEEDS-DEVICE** (F01 safe-area,
  N5 status-bar tint), **1 NEEDS-CAPTURE** (N7 app icon), **2 UNVERIFIED**
  (F23 needs seeded save, F24 needs a reference pause).
