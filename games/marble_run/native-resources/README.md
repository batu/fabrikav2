# native-resources/

Source inputs for the Capacitor native shells — app icons, splash screens,
platform resource overlays (e.g. `android-res/`). These are committed **inputs**;
the generated native projects (`ios/`, `android/`) are build artifacts produced
on demand and are **never committed here** (v1's `find_the_dog/ios/` checked in a
2.3GB Xcode build tree — do not repeat it). `capacitor.config.ts` at the game
root points the native build at these resources.

## iOS platform recipe (generated `ios/`, never committed)

The `ios/` project is produced on demand and signed by a committed idempotent
script, so a fresh checkout can always rebuild it:

```sh
# from games/marble_run
VITE_ENABLE_TEST_HARNESS=true VITE_INSITU_TOUR=<state> npm run build
npm run ios:add     # npx cap add ios + cap sync ios + inject signing team
# ...or, when ios/ already exists:
npm run ios:sync    # npx cap sync ios + inject signing team
```

`npm run ios:add` / `ios:sync` end by running `scripts/ios-inject-team.mjs`,
which inserts `DEVELOPMENT_TEAM = 42L77JAX72;` after **every**
`CODE_SIGN_STYLE = Automatic;` in `ios/App/App.xcodeproj/project.pbxproj`
(idempotent; re-runs are a no-op). This mirrors v1 sugar3d's hand-edited pbxproj
and covers plain-Xcode and Pixelsmith builds; `tools/verify-device` passes the
same team id as an xcodebuild setting for its own lane. The team id is an Xcode
build-setting constant, not a secret.

### Pixelsmith capture states

Pixelsmith launches the installed app with no arguments and waits ≤25s for a
`tourstate:<state>` accessibility marker, so the target state is baked at build
time. Build one state per sync:

```sh
VITE_ENABLE_TEST_HARNESS=true VITE_INSITU_TOUR=home-fresh npm run build && npm run ios:sync
```

Supported states: `home-fresh`, `level-map`, `gameplay-opener`,
`gameplay-plugs`, `gameplay-voids`, `gameplay-teach`, `win`, `pause`, `shop`,
`settings` (see `src/testing/pixelsmithStates.ts`). `VITE_INSITU_TOUR=allstates`
keeps the six-state verify-device walk unchanged.

## iOS viewport contract

Find The Dog's v1-verbatim layout constants assume a full-bleed WKWebView whose
`UIScrollView.contentInsetAdjustmentBehavior` is `never`. Keep that pinned in
`capacitor.config.ts` under `ios.contentInset`; Capacitor maps the value onto
the Web View scroll view's native content-inset adjustment behavior during
`npx cap sync ios`.

The generated `ios/` project is intentionally not committed. If a future native
card adds a custom `CAPBridgeViewController`/AppDelegate override, preserve the
same contract there as well:

```swift
bridge?.webView?.scrollView.contentInsetAdjustmentBehavior = .never
```

Do not compensate for an iOS viewport-height delta by changing game layout
constants. Run the harness build with `VITE_ENABLE_TEST_HARNESS=true
VITE_INSITU_TOUR=allstates`; the off-screen `#__viewportmetrics__` accessibility
marker publishes `window.innerHeight`, `visualViewport.height`, `screen.height`,
CSS `env(safe-area-inset-*)`, DPR, and canvas height for the conductor's device
capture.
