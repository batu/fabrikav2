# verify-device XCUITest runner (committed template)

The on-device capture lane for `verify-device`, generalised from the ad-hoc
`games/marble_run/.work/insitu-runner` so **every game inherits it** instead of
re-authoring a `.work/` throwaway.

## What it is

A standalone **UI-testing bundle** (`bundle.ui-testing`) — no host app. It
launches the already-installed game app **by bundle id** and captures a real
device screenshot (`XCUIScreen.main.screenshot()`) per canonical state. Screenshots
attach to the `.xcresult`; `verify-device` extracts them via
`xcrun xcresulttool export attachments`.

## Generic across games

The target bundle id is **injected, never hardcoded** — the CLI runs:

```sh
TEST_RUNNER_TARGET_BUNDLE_ID=<appId> \
xcodebuild test -project VerifyDeviceRunner.xcodeproj -scheme VerifyDeviceRunner \
  -destination id=<device-udid> -allowProvisioningUpdates \
  -resultBundlePath <out>/device.xcresult
```

`xcodebuild` forwards `TEST_RUNNER_`-prefixed vars to the test process with the
prefix stripped, so `InsituTourTests` reads `TARGET_BUNDLE_ID` from its
environment. One file, all games.

## Files

- `project.yml` — xcodegen spec with the committed studio dev team default. The
  CLI runs `xcodegen generate` every time so stale generated projects cannot be
  reused; a runtime `DEVELOPMENT_TEAM` override is passed to `xcodebuild` as a
  build setting.
- `VerifyDeviceRunner/InsituTourTests.swift` — the capture test.

## Why element-gated, not timed

Earlier revisions shot on a fixed dwell timer and stamped the intended state name.
That drifts: `driveTo` is variable-time, so the timer fired on the wrong frame and
labelled menu/level as settings/fail (docs/evidence/2026-07-06-2315-paired/ +
docs/retros/fidelity-diff-mistakes-ledger.md — the exact bug this whole card
exists to kill).

The runner now **waits for the state before shooting**. The `allstates` tour, on
CONFIRMING each state via the harness snapshot, publishes an accessibility element
labelled `tourstate:<state>` (a hidden `role=text` node `#__tourstate__` in
`@fabrikav2/testkit/testing` `maybeRunInsituTour`). The WKWebView surfaces that `aria-label`
to the native accessibility tree, so `InsituTourTests` matches
`label == "tourstate:<state>"`, `waitForExistence(timeout:)`, and screenshots only
once it exists. **A state that never appears is a loud `XCTFail`** (and a
`<n>-<state>-MISSING` attachment for inspection) — a missing state is never a
silent wrong frame. The tour requires `VITE_ENABLE_TEST_HARNESS=true` +
`VITE_INSITU_TOUR=allstates` in the installed bundle.
