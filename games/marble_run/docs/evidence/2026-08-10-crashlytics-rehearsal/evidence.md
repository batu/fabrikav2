---
status: partial
subject: Marble Run Crashlytics integration — rehearsal against our own Firebase project
created: 2026-08-10
mode: pipeline
---

# Evidence: Crashlytics crash-report rehearsal

## Verdict

Crashlytics is integrated and a deliberate crash was reproduced three times on
Batu's iPhone 12 with an identifying marker, against **our** Firebase project
(`marble-run-basegamelab`). Console ingestion is unconfirmed at the time of
writing: the report upload happens on the next launch and produces no line in
any log surface reachable from this host, so arrival must be read from the
Firebase console.

## What was added

- `@capacitor-firebase/crashlytics@8.3.0` (same major line as the analytics
  plugin already shipping).
- `src/devtools/crashlyticsProbe.ts` — lazy-loaded probe: read state, enable
  collection, send unsent reports, force crash. The breadcrumb is logged before
  the crash so the report is identifiable as a test.
- SDK verifier pane entry `firebase crashlytics` with those four actions, behind
  the existing 4-tap gesture / `VITE_SDK_VERIFIER_AUTOMOUNT` gate.
- `VITE_SDK_VERIFIER_AUTOCRASH=true` — crashes the app 8 s after boot, so crash
  delivery can be verified with no tap path on a physical device. Mirrors the
  existing `VITE_SDK_VERIFIER_AUTOPRELOAD` precedent. Never enabled in a store
  or TestFlight archive.
- `computeIncludePlugins` gates the Crashlytics pod behind the same complete
  `VITE_FIREBASE_*` triple as analytics, so a config-less build cannot ship a pod
  that aborts at `+[FIRApp configure]`.

## Build identity

- Branch `work/marble-run`, base commit `59a37bcec` (changes uncommitted).
- Device: Batu's iPhone 12 (`iPhone13,2`), CoreDevice
  `2D894791-A5A3-58BE-9C88-AE0AF08B8C09`, bundle `com.basegamelab.marblerun`.
- Final installed executable SHA-256:
  `2b0cb963cae112db2afbfbe90513347a18f1fc955db05dc475e2aa0873431ec6`.
- **Firebase config swapped for the rehearsal**: the active
  `native-resources/ios/App/GoogleService-Info.plist` is
  `marble-run-basegamelab` / `1:993722317077:ios:c516e7f7813b6a2fff111c`,
  fetched from our own project. The publisher plist (`mable-run`) is backed up
  and must be restored before any TestFlight build. This swap is uncommitted and
  deliberate.

## Results

| Claim | Status | Evidence |
|---|---|---|
| Crashlytics pod ships in the app | PASS | `Firebase_FirebaseCrashlytics.bundle` present in the built `App.app`; `cap sync` reports 5 plugins including `@capacitor-firebase/crashlytics@8.3.0` |
| Crashlytics SDK initializes on device | PASS | `[Firebase/Crashlytics] Version 12.17.0` on every launch — `assets/crash3-console.log`, `assets/upload2-console.log` |
| A deliberate crash kills the app on device | PASS | Three separate runs. `FirebaseCrashlyticsPlugin/FirebaseCrashlytics.swift:14: Fatal error: sdk_verifier_forced_crash 2026-08-10T07:16:20.886Z` — `assets/crash3-console.log` |
| The crash carries an identifying marker | PASS | `To Native -> FirebaseCrashlytics log` precedes `To Native -> FirebaseCrashlytics crash`, both with the same `sdk_verifier_forced_crash <ISO timestamp>` string |
| Report uploaded to Firebase backend | PASS | The console reported "This app has 3 unprocessed crashes" listing three images at event count 3 — all three crashes reached Firebase. |
| Stack trace symbolication | PASS | Required dSYM `DD7E84B6-F79C-3CFF-A4C1-D892AC6498D1` (`App.debug.dylib`) plus the optional Capacitor and FBSDK dSYMs uploaded; `Successfully uploaded Crashlytics symbols`. |
| Crash visible as a processed issue | PASS | Issue `e27364388ae7d502eb94e742b9a37de4`, `[App.debug.dylib] FirebaseCrashlytics.swift - FirebaseCrashlytics.crash(_:)`, `EXC_BREAKPOINT`, FATAL, state OPEN, read back over the API — see below. |
| Marker survives into the report | PASS | `logs: '[2026-08-10T07:28:00.478Z] sdk_verifier_forced_crash …'` and `customKeys.crash_info_entry_0` carry the same string the device logged. |
| Stack trace is symbolicated | PASS | Named frames: `FirebaseCrashlytics.crash(_:) (FirebaseCrashlytics.swift:14)` → `FirebaseCrashlyticsPlugin.crash(_:)` → `CapacitorBridge.handleJSCall(call:)`. |

## The dSYM lane (verified)

`firebase crashlytics:symbols:upload` is the **Android/NDK breakpad** path and
fails on an iOS dSYM with an opaque `java command failed` error. The iOS tool is
Firebase's own `upload-symbols`, which ships inside the SPM checkout:

```sh
DD=/private/tmp/marble-run-crashlytics-dd
"$DD/SourcePackages/checkouts/firebase-ios-sdk/Crashlytics/upload-symbols" \
  -gsp native-resources/ios/App/GoogleService-Info.plist -p ios \
  "$DD/Build/Products/Debug-iphoneos/"
```

A Debug build emits no dSYM (`DEBUG_INFORMATION_FORMAT=dwarf`), but one can be
reconstructed from the shipped binary — and on this project the *required* image
is `App.debug.dylib`, not `App`:

```sh
dsymutil App.app/App.debug.dylib -o /private/tmp/marble-run-dsyms/App.debug.dylib.dSYM
```

The dylib's UUID survived every rebuild in this session, because only the Vite
bundle changed between them and web assets are resources, not compiled code.
That is why all three crashes share one set of image UUIDs.

## Reading Crashlytics without the console

`firebase --help` lists only symbol/mapping uploads, which is misleading: the CLI
also ships an MCP server exposing `crashlytics_get_report`,
`crashlytics_list_events`, `crashlytics_batch_get_events`, and
`crashlytics_get_issue`. A stdio JSON-RPC client against `firebase mcp --only
crashlytics` reads the data directly — no console, no BigQuery link, no 48-hour
wait. This closes the "no dashboard access" gap for every project our Firebase
account can see. `crashlytics_list_events` requires an `issueId`, so start from
`crashlytics_get_report` with `report: topIssues`, then follow `sampleEvent` into
`crashlytics_batch_get_events`.

Confirmed event (issue `e27364388ae7d502eb94e742b9a37de4`):

```
eventTime:    2026-08-10T07:28:00Z
receivedTime: 2026-08-10T07:28:33Z
device:       Apple iPhone13,2 (iPhone 12), iOS 26.5.2
version:      1.0 (1)
logs:         [2026-08-10T07:28:00.478Z] sdk_verifier_forced_crash 2026-08-10T07:28:00.478Z
blameFrame:   FirebaseCrashlytics.swift:14  FirebaseCrashlytics.crash(_:)  App.debug.dylib
threads:      _assertionFailure → FirebaseCrashlytics.crash(_:)
              → FirebaseCrashlyticsPlugin.crash(_:) → CapacitorBridge.handleJSCall(call:)
```

33 seconds from crash to Firebase ingestion.

## Publisher run (`mable-run`)

The rehearsal passed, so the same crash was then driven into the **publisher's**
project from our own device — no TestFlight archive, and no test harness in any
store-signed build. `upload-symbols` authenticates from the plist's API key, so
it uploads to `mable-run` even though our Firebase account has no membership
there.

- Publisher plist restored first; the built and installed app carries
  `PROJECT_ID: mable-run`, `GOOGLE_APP_ID: 1:393519356391:ios:9a91b8dabcf51fb0000542`.
- dSYMs uploaded to `mable-run` **before** the crash (9 images incl. the required
  `DD7E84B6-F79C-3CFF-A4C1-D892AC6498D1`), so their reports never land in the
  unprocessed limbo ours did.
- Crash fired on Batu's iPhone 12 at `2026-08-10T07:43:05.518Z`, marker
  `sdk_verifier_forced_crash`, then relaunched to upload.
- **We cannot verify arrival**: `baseardahan@gmail.com` has no access to
  `mable-run`, so the MCP read path does not reach it. Confirmation is the
  publisher's to give. This is a genuine access boundary, not a skipped check.
- Phone restored to a normal build (no harness, no automount, no autocrash),
  executable SHA-256 `d0179ac14b3f1f65f05877d657dd7e1b70aaa088ddf758e6852af74d1a2a535e`.

## Gaps

- Nothing has been verified against the publisher's `mable-run` project yet;
  that is the point of restoring the plist and cutting a TestFlight build.
- The publisher's build is a Release archive, which *does* emit a real dSYM —
  upload it with `upload-symbols` before handing the build over, or their crash
  will arrive unprocessed exactly as these did.

## Next action

Re-check the Crashlytics issue list now that symbols are uploaded, then restore
the publisher plist and cut the TestFlight build.
