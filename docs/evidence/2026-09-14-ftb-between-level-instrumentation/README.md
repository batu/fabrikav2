# Find the Bird between-level instrumentation (2026-09-14)

Evidence for `docs/handoffs/2026-09-14-ftb-between-level-instrumentation.md`. Report: `report.html` (posted to Portal stream `find-the-bird-ads`).

- Remote Config: production does not read it (`SdkContext.ts` ignores the disable flag; `firebaseApp.ts` returns null). Experiment arms are builds until that is ported from FTD.
- `device/`: iPhone 12 run of a Debug build of this branch with the production iOS env and the test harness. `events-levels-1-4.json` is the analytics ring drained during levels 1 → 4 (interstitial after the third completion); `events-muted-ads-and-abandon.json` covers completions 4 → 6 with ads off plus a mid-level background; `drive-log.jsonl` is the drive's own log. The interstitial was dismissed when the XCUITest session ended, not by a close tap.
- GameAnalytics (project 351396, 2026-09-14 UTC): `level_complete:shown` 8, `level_complete:action` 7, `interstitial:gate` 6, `level:next_ready` 6, `level:abandoned` 1, `ad:lifecycle` 87, all from the device runs.
- First experiment proposal: read the first week of 1.2.5+ data as a natural split (`interstitial_gate reason=first_session` from PR #76 vs `cadence`), then choose between raising `interstitialMinLevel` (build arm) and shortening the completion-screen reveal; details in the report.
