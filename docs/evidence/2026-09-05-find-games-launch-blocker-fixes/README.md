# Find Games launch-blocker repair evidence

Baseline: `0565291694f88f45dba83e1e734adac45ae09cc4`; local branch `fix/find-games-launch-blockers-20260905`.

The source repairs and verification are described in [the handoff](../../handoffs/2026-09-05-find-games-launch-blocker-fixes.md). Full source receipt, test logs, isolated actual-SDK diagnostics and independent reviews are retained at `/Users/base/store-review/find-games/launch-blocker-fixes-20260905-rleTkK/`.

`collector/` is an evidence snapshot of the repaired canonical external collector and its offline tests. The canonical runtime remains `/Users/base/.hermes/scripts/find-games-daily-scorecard.mjs`; this directory does not install a second collector or schedule it. The external original files are backed up in the artifact directory, with before/after hashes and patches in `source-final.json` and adjacent files. Older evidence snapshots remain unchanged.

The canonical external collector received concurrent edits after this repair checkpoint, including rendered demo-banner visibility checks. Those newer bytes were preserved during commit preparation. This snapshot records the earlier 19-test checkpoint and must not overwrite the current canonical collector.

Only automated/source evidence was collected. No collector entrypoint, live provider, operator browser, device, release build or campaign was run. Keep `/Users/base/store-review/find-games/RELEASE-BUILD-HOLD.md` in force.
