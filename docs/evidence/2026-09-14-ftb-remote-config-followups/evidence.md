---
status: partial
subject: Find Games non-release between-level follow-ups
created: 2026-09-14
mode: interactive
---

# Evidence: non-release between-level follow-ups

## Verdict

Dog parity is merged, Bird Remote Config fetched on the physical iPhone, and both reconstructed archive commands match; the close-tap proof and phone-save restoration are blocked by another lane's device ownership, while the funnel remains blocked on a store release.

## Checklist against handoff section 4

1. **Done — Dog parity.** PR [#82](https://github.com/batu/fabrikav2/pull/82) merged as `60a671e5f021cc5dec860f073cf611666d622bde`, after Bird PR #79. Six events use the existing analytics path. Dog unit suite: 467 passed, two existing skipped; typecheck and lint passed. The merge-conflict resolution preserved `purchase_failed` mappings; its focused 64 tests and typecheck passed. Original evidence is `docs/evidence/2026-09-14-ftd-between-level-followups/evidence.md` on main.
2. **Done — Bird Remote Config code and device readback.** Branch `fix/ftb-remote-config-followups`, code commit `4ac0a15841aee6528ac06a31410b8ded486ad467`. Ported Dog's env-driven Firebase initializer and honored `VITE_FTD_DISABLE_REMOTE_CONFIG` through `parseBooleanEnv`. Bird unit suite: 504 passed, three existing skipped (79 files); typecheck and lint passed. Existing injected-provider tests cover successful fetch and offline fallback. The installed physical iPhone build reported SHA `4ac0a15841`, `dirty: false`, Remote Config `state: ready`, `lastFetchStatus: success`, `fetchTimeMillis: 1789392052207`, and no error. Active sources were defaults. See `assets/remote-config-device-readback.json`. No template values were changed.
3. **Blocked — real close-tap proof and save restoration.** The first attempt emitted `interstitial_gate(cadence)`, `ad_lifecycle(show_requested)`, and `ad_lifecycle(shown)`, but did not produce an accepted close sequence. The test runner waited for WebView idleness, then encountered a stale runner bundle identifier. A distinct runner removed that wait; bounded button queries could not access the visible close control. A coordinate tap through the app did not dismiss the observed sheet. A later device-level synthesized tap succeeded at the input API, but the resulting screenshot showed another lane's onboarding build and is rejected as evidence for this lane. No under-30-second dismissal/next-level claim is made.
4. **Done — archive reconstruction verified.** Both 19-argument archive commands exactly match their recorded JSON; the diff is empty, so no script edit was needed. Verified using AST evaluation of the archive tuple and literal game matrix, without executing `build-ios.py`. The required note is `/Users/base/store-review/find-games/ios-submission-20260914/archive-command-verification.md`; fingerprints are also copied into `assets/archive-command-verification.json`.
5. **Blocked — funnel report.** No store build carrying this instrumentation with 24 hours of users has been established. Do not query this QA session as a production funnel or select an experiment arm from it. Resume the original handoff's query recipe only after that prerequisite exists and reporting is authorized.

## Device ownership and save custody

The original phone WebKit container was backed up before installation, and 34 localStorage keys were backed up before `resetSave`. Both are private under `/Users/base/store-review/find-games/ftb-remote-config-followups-20260914/` (`phone-webkit-before/`, `localstorage-before.json`).

At conflict discovery, `/Users/base/dev/appletolye/.twf-device/physical-device.lock` was held by `ftb-onboarding-layer`, owner PID 95584, with an active `FindBirdOnboardingTests` process. The lease had already existed when this lane started; checking only active build/test processes missed it. Device interaction stopped immediately after discovery. The lane's relay on port 5322 was stopped; other agents' runners, relay, worktrees, and files were not stopped or reverted.

**The original save has not yet been restored.** Restoration now requires the device owner to release the phone. Private `RESTORATION-PENDING.md`, `save-backup-manifest.json`, and `restore-localstorage-private.js` make this obligation recoverable. The restoration script has not run and contains private data; never commit it. After acquiring the lease, restore the backed-up values and verify persisted game state after reload before further reset-based testing.

## Capture and review limits

Native build, installation, launch, and Remote Config readback were verified before the conflict. Physical screenshots were opened and inspected. The later onboarding screenshot fails the build-identity requirement and cannot establish an ad-close result. No visual reviewer was asked to approve an invalid capture. Earlier attempts and native test results remain in the private evidence directory, including `close-proof.xcresult`, `close-recovery2.xcresult`, `store-sheet-close.xcresult`, and `direct-close.xcresult`.

## CI and cleanup

Combined post-merge CI: [run 34842607117](https://github.com/batu/fabrikav2/actions/runs/34842607117). All completed jobs passed, including Dog. Bird stalled in checkout for over 35 minutes before running checks; the run was cancelled and only the incomplete job was retried. Do not describe the combined run as green until the retry completes.

User-authorized generated-output cleanup recovered approximately 12.5 GiB as measured by filesystem free bytes. Review/result manifests and retained diagnostic files are under `/Users/base/store-review/find-games/cleanup-20260914-followups/`, including `september02/`. Release archives/IPAs, active outputs, and unrelated worktrees were preserved. The completed Dog worktree was removed earlier with recovery refs retained. This Bird worktree remains active and must not be cleaned up while these obligations remain.

No store submission, TestFlight upload, App Store Connect mutation, Remote Config mutation, or paid generation/API operation was performed by this follow-up work. Live ad requests used the existing app configuration; no advertiser-spend amount is inferred from those requests.

## Next action

After `ftb-onboarding-layer` releases the physical-device lease, acquire it and restore the private phone save first. Then repeat the close proof against a verified installed build with before/after screenshots, `dismissed - shown < 30000 ms`, and `next_level_ready.gap_ms < 30000`. The funnel remains explicitly blocked until a qualifying store build has 24 hours of users.
