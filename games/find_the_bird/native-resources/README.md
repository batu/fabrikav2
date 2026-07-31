# native-resources/

Source inputs for the Capacitor native shells — app icons, splash screens,
platform resource overlays (e.g. `android-res/`). These are committed **inputs**;
the generated native projects (`ios/`, `android/`) are build artifacts produced
on demand and are **never committed here** (v1's `find_the_dog/ios/` checked in a
2.3GB Xcode build tree — do not repeat it). `capacitor.config.ts` at the game
root points the native build at these resources.

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

## iOS native-shell recipe

Durable app files live in `ios/App/`; `tools/verify-device` copies that directory
into the generated `ios/App/App/` tree. The sibling `ios/shell-manifest.json` and
AppLovin SKAdNetwork catalog are patch inputs, not bundle resources.

After `cap sync ios`, run the shared `tools/native-shell/apply.mjs` command from
the game package, then `tools/native-shell/validate.mjs`. The apply command also
copies `ios/App/`, replaces the generated Swift package graph, stamps the iOS
identity, merges plist policy, and wires Xcode references. Both commands tolerate
an absent gitignored Firebase plist; any plist that is present is identity-checked.
