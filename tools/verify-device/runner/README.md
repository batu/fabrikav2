# verify-device XCUITest runner (committed template)

The on-device capture lane for `verify-device`, generalised from the ad-hoc
`games/marble_run/.work/insitu-runner` so **every game inherits it** instead of
re-authoring a `.work/` throwaway.

## What it is

A standalone **UI-testing bundle** (`bundle.ui-testing`) — no host app. It
launches the already-installed game app **by bundle id** and captures a real
device screenshot (`XCUIScreen.main.screenshot()`) per canonical state, on the
same 6s dwell cadence as the `allstates` insitu tour
(`games/<g>/src/testing/insituTour.ts`). Screenshots attach to the `.xcresult`;
`verify-device` extracts them via `xcrun xcresulttool export attachments`.

## Generic across games

The target bundle id is **injected, never hardcoded** — the CLI runs:

```sh
xcodebuild test -project VerifyDeviceRunner.xcodeproj -scheme VerifyDeviceRunner \
  -destination id=<device-udid> -resultBundlePath <out>/device.xcresult \
  TEST_RUNNER_TARGET_BUNDLE_ID=<appId>
```

`xcodebuild` forwards `TEST_RUNNER_`-prefixed vars to the test process with the
prefix stripped, so `InsituTourTests` reads `TARGET_BUNDLE_ID` from its
environment. One file, all games.

## Files

- `project.yml` — xcodegen spec. `DEVELOPMENT_TEAM` is taken from the environment
  (falls back to the studio dev team). The CLI runs `xcodegen generate` here when
  the `.xcodeproj` is absent, so only the spec + Swift are committed.
- `VerifyDeviceRunner/InsituTourTests.swift` — the capture test.

## Why the cadence, not the DOM attr

The tour marks `body[data-tour-state]`, but XCUITest can't read that WKWebView DOM
attribute reliably across the bridge (see the insitu-runner comments), so capture
is timed to the tour's confirmed-state dwell and each shot is stamped with its
intended canonical state name. The tour itself only dwells **after** confirming
`snapshot().scene` (harness ledger), so the beat lines up.
