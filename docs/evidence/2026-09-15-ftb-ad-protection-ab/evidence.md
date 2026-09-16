# FTB ad protection A/B implementation evidence

Verdict: partial. Policy and analytics behavior pass local integration checks;
physical-device and live-provider acceptance are not yet complete.

Source: `feat/ftb-ad-protection-ab` in
`/Users/base/dev/appletolye/fabrikav2/.worktrees/ftb-ad-protection-ab`.

## Verified

- 129 tests passed across ad-protection-experiment, session-ad-policy,
  level-banner-policy, between-level-analytics, sdk-context,
  bootstrap-analytics-chain, analytics-lifecycle-flush, and gameanalytics-sink.
- Bird `npm run typecheck`, `npm run lint`, and `npm run build` passed.
- Bootstrap tests traverse the real bootstrap entry, retaining the mocked runtime
  boundary; service tests exercise real policy and service with a recording ad
  provider, not real ad delivery. SDK and GA sink tests prove assignment fields
  survive composition and projection, not provider ingestion.
- Correctness review found and resolved lost GameAnalytics exposure dimensions.
  Follow-up review found no blocking code findings.
- Reuse review found no behavior-equivalent consolidation. Efficiency review's
  repeated policy read was consolidated at the interstitial decision. Quality
  review suggested removing the existing boolean gate input; deferred because
  preserving its established caller contract avoids broadening this change.

## Physical lane

Canonical `verify-device` attempted on iPhone 12, hardware UDID
`00008101-000410EC3EF9001E`, under the shared exclusive device lease.
The first invocation used CoreDevice's identifier rather than the hardware UDID
and failed discovery. The second reached native build but lacked the worktree
node_modules path; a link to the existing dependency installation resolved that.
The corrected retry built and installed successfully using the repository signing
team. The installed source is base `bc89e2d196` plus this working diff; web build
stamp is `2026-09-14T22:43:32.963Z`. A fresh DVT screen capture was opened and
inspected: the game reached its completion screen and retained the optional
`Claim 2x / Watch ad` offer. This does not prove both experiment arms on device.
The XCUITest invocation did not return within ten minutes and was interrupted;
its incomplete result is not a passing physical acceptance check.
Final device CLI exit: 1, `NO-APPLICABLE-EVIDENCE`, with failed capture-runner
integrity, ungated captures, missing states, and no trusted reference coverage.
The memory gate independently passed: peak 1022 MB over 91 samples, below 1280 MB.
The native subprocess has exited and its exclusive device lease is released.
Log: `/private/tmp/ftb-ad-protection-ab-device/verify.log`.
Vision panel intentionally skipped: this run cannot claim a full visual gate pass.
Web Inspector also reported disabled on the phone, so interactive assignment
inspection was unavailable. Captures inspected:
`/private/tmp/ftb-ad-protection-ab-device/current.png` and `current-2.png`.

## Release gates

No App Store upload/submission or live configuration change was performed.
No live A/B population or provider event receipt has been verified. Enrollment
starts with fresh installs of a released build containing this implementation;
allocation changes require a new release in this revision.

Next action: finish the device run, verify both arms and optional rewards, then
verify ingestion and release state before activating the experiment for users.

## Device run 2026-09-16 (harness build, JS relay)

Lane: `VITE_ENABLE_TEST_HARNESS=true vite build --mode ios`, cap sync, native-shell
apply (Firebase plist wired from the main checkout), relay `inject.html` into
`ios/App/App/public/index.html` on port 5400, `NSAllowsArbitraryLoads`, xcodebuild
Debug with `DEVELOPMENT_TEAM=42L77JAX72`, `devicectl install` + `process launch`.
Device: iPhone 12, `00008101-000410EC3EF9001E`. Base commit `58acf01b2`.

Verified on device:

- Pre-existing install reports assignment `existing`; the exclusion rule holds on
  real hardware rather than only in unit tests.
- A forced `protected` assignment survives `location.reload()` and a full
  re-bootstrap, confirming sticky persistence through the real storage path.
- `protected` arm blocks automatic interstitials: four level completions at level
  8 (<= 10), "Next Level" tapped each time, maximum page-timer gap 477 ms / 459 ms.
  A presented native interstitial freezes page timers for seconds, so sub-500 ms
  gaps establish that no interstitial was shown.
- The level-complete overlay retained `CLAIM 2x / Watch ad` in the protected arm;
  optional rewarded ads are unaffected as specified.

Not verified:

- The `from_start` control arm was not driven. Without it, "no ad in protected"
  is not yet a comparison: nothing on this device run proves an interstitial WOULD
  have shown under the same cadence in the other arm. This is the single missing
  piece of device acceptance.
- Provider ingestion (GameAnalytics / AdMob receipt of `experiment_exposure` and
  the `ad_experiment_*` dimensions) remains unverified; the run logged
  "Event queue: Failed to send events to collector - Retrying next time".
- No release or live configuration change was made.

Lane traps hit: `relay.py` hardcodes its port (5321) and ignores argv; ports 5321,
5197 and 5196 were held by stale servers from earlier sessions. A fresh worktree
has no `DEVELOPMENT_TEAM` and no Firebase plist. The phone auto-locks within a few
minutes without a test runner, which suspends the webview and silently kills the
relay mid-drive; every stall in this run traced to that, not to app crashes.
