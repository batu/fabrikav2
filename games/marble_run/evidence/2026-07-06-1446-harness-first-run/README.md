# Harness first-run evidence (marble_run)

Evaluation input for card **KEghp3x4** (Harness evaluation). Produced by
`games/marble_run/tests/e2e/collect-run.spec.ts` via the testkit
`collectRun()` writer over the `GameHarness` witnesses.

## Capture provenance

- **All screenshots are CHROMIUM / BROWSER captures** (Playwright viewport
  390×844). The on-device capture path is an
  unwired stub (`captureToDeviceDocuments`, insitu ledger gap 1) and was NOT
  used. No claim of on-device capture is made.
- `screenshots/canvas-witness-playing.png` is the in-game `harness.capture()`
  browser canvas path (`captureCanvasPng`); the rest are full page composites.

## Contents

- `screenshots/home-menu.png`
- `screenshots/settings.png`
- `screenshots/playing-level-1.png`
- `screenshots/canvas-witness-playing.png`
- `screenshots/pause-overlay.png`
- `screenshots/result-card.png`
- `snapshots.json` — stamped snapshot envelopes (packageId + buildVersion guard).
- `events.json` — analytics trace (5 events) drained from the RingBufferSink.
- `perf.json` — frame-time buckets (221 frames, worst 835.6ms).
- `manifest.json` — the run index.
