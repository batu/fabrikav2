# Find Games launch-blocker source repairs

Implementation worktree: `/tmp/fabrikav2-launch-fixes-pIMYeP/source`, branch `fix/find-games-launch-blockers-20260905`, baseline `0565291694f88f45dba83e1e734adac45ae09cc4` (includes PR54 and PR55). Batu authorized committing and merging these repairs after the automated/source review. The PR and Git history record the landing revision; merge approval does not authorize a release build. Preserve the dirty/stale primary and the original review checkout.

Full report and exact source hashes: `/Users/base/store-review/find-games/launch-blocker-fixes-20260905-rleTkK/report.md` and `source-final.json`. The source patch and full logs are beside them. The original independent launch review remains `/Users/base/store-review/find-games/launch-blocker-review-20260905-THSAuX/report.md`.

The repair checkpoint passed 429 Bird tests, 346 Dog tests, 375 shared SDK tests, 21 release-helper tests and 19 collector tests. Five private-credential tests were skipped. Typechecks/lints passed; repository audit passed with warnings. Independent purchase and actual-SDK analytics reviews passed. The commit/merge receipt is maintained separately under `/tmp/fabrikav2-launch-merge-DlnWLr/` so the original pre-commit evidence stays immutable.

PR: https://github.com/batu/fabrikav2/pull/57. The collector's completed visibility repair supersedes that historical 19-test checkpoint: 20 offline tests and six real offline Chromium rendering cases pass. The snapshot now matches the owner's canonical files exactly; see [closure hashes](../evidence/2026-09-05-find-games-launch-blocker-fixes/closure-checkpoint.json). Prior originals and receipts remain preserved. The owner's closure evidence, independent review and sanitized existing-page DOM observation are under `/Users/base/store-review/find-games/launch-blocker-fixes-20260905-rleTkK/closure/`. Final publication state is recorded at `/Users/base/store-review/find-games/launch-repair-closure.md`.

## Repairs

- B1, both games: shared IAP now journals ordinary received successes before returning them to callers, as well as late successes. Acknowledgement follows the existing atomic wallet/transaction checkpoint. Known wallet/journal failure blocks a new native dispatch. HUD and continue callers report pending delivery, acknowledge durable grants/duplicates and retain obsolete-scene protections. Reconciliation snapshots pending entries so failed acknowledgement cannot spin on reinsertion.
- B2/N3, both games: preserve the bounded GA queue after readiness exhaustion and probe the retained SDK on later events/flushes. Resume starts the canonical session before foreground. Every manual session restart waits for the old GA session to close and the new asynchronous request to become ready before draining events. Promise cleanup also permits another session after a successful immediate probe.
- N1: iOS release helpers reject `FTB_DEV_SHELL_URL` and packaged Capacitor `server.url`, including stale generated configuration. No native sync/build was executed.
- N2: canonical external collector requires successful navigation, matching document loader/project URL, complete content, no rendered demo banner and a valid DAU before labeling the GA snapshot healthy. Collapsed demo text alone does not reject genuine pages; visible demos and failed identity/navigation remain unavailable/null. An [evidence copy](../evidence/2026-09-05-find-games-launch-blocker-fixes/README.md) is included; do not run it as another collector.

## Evidence and remaining gates

The report records full Bird, Dog and shared SDK unit suites, typechecks/lints, audit, release-helper tests, collector tests and isolated actual GameAnalytics 4.4.7 diagnostics. Purchase tests execute each game's real wrapper/catalog/fulfillment/wallet against a fake store and controlled storage failures. Actual-SDK tests isolate network, identity and clocks; SDK acceptance is not live ingestion.

Storage that becomes unwritable after payment cannot promise durability across process death before a journal write. Transactions never received by JavaScript still need provider reconciliation. The GA wrapper queue remains memory-only and bounded at 100; recovery probes are event/flush driven. Existing operational and release-lane observations from the original review remain explicit, including provider/privacy/disclosure verification, Bird identity validation and executor pin maintenance.

Do not start an archive/export/upload, operate the shared phone, change providers or activate campaigns. Batu must approve the final exact source checkpoint first; the release-build hold is unchanged. The next owner should review the patch and report before requesting that checkpoint.
