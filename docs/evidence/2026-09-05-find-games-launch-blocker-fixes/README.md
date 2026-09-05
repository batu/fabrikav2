# Find Games launch-blocker repair evidence

Baseline: `0565291694f88f45dba83e1e734adac45ae09cc4`; local branch `fix/find-games-launch-blockers-20260905`.

The source repairs and verification are described in [the handoff](../../handoffs/2026-09-05-find-games-launch-blocker-fixes.md). Full source receipt, test logs, isolated actual-SDK diagnostics and independent reviews are retained at `/Users/base/store-review/find-games/launch-blocker-fixes-20260905-rleTkK/`.

`collector/` is an evidence snapshot of the repaired canonical external collector and its offline tests. The canonical runtime remains `/Users/base/.hermes/scripts/find-games-daily-scorecard.mjs`; this directory does not install a second collector or schedule it. The external original files are backed up in the artifact directory, with before/after hashes and patches in `source-final.json` and adjacent files. Older evidence snapshots remain unchanged.

The collector snapshot now includes the completed hidden-demo-banner repair handed off by its owner. The original body-text regex could reject genuine GA documents because collapsed demo-banner text remains in `innerText`. The repaired snapshot checks rendered geometry, ancestor visibility/opacity and overflow clipping while preserving project URL and document-loader identity checks.

The historical 19-test checkpoint is preserved in commit `97d93b65c844041f9a415ae57abe7e081a7514b1` and the original external receipts. The corrected checkpoint passes 20 offline collector tests and six real offline Chromium rendering cases; these are not 39 different collector tests. Exact canonical/snapshot hashes are in [closure-checkpoint.json](closure-checkpoint.json). Original preserved files and red/green logs remain under `/Users/base/store-review/find-games/launch-blocker-fixes-20260905-rleTkK/closure/` and `/tmp/fabrikav2-launch-merge-DlnWLr/collector-followup/`.

The handoff's sanitized read-only observation of Dog project 350269 found `rawTextContainsDemo=true`, `visibleDemo=false`, and `stableDocument=true`. That observation evaluated an existing live-events document without navigation or a full collector/provider run; it does not prove metric health, backend ingestion or release-binary acceptance. Before publishing this follow-up, the current owner reran both the canonical and repository-snapshot offline suites (20 passed each) and all six offline Chromium rendering cases (passed).

Evidence is automated/source plus the handoff's bounded read-only live DOM observation. No collector entrypoint, provider operation, device, release build or campaign was run. Keep `/Users/base/store-review/find-games/RELEASE-BUILD-HOLD.md` in force.
