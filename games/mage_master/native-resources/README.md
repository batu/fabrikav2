# native-resources/

Source inputs for the Capacitor native shells — app icons, splash screens,
platform resource overlays (e.g. `android-res/`). These are committed **inputs**;
the generated native projects (`ios/`, `android/`) are build artifacts produced
on demand and are **never committed here** (v1's `find_the_dog/ios/` checked in a
2.3GB Xcode build tree — do not repeat it). `capacitor.config.ts` at the game
root points the native build at these resources.

## Fresh-shell recipe

Run `npx cap add ios` and/or `npx cap add android` once from the game directory
when a device lane first needs that platform. Keep the generated `ios/` and
`android/` trees gitignored. `verify-device` runs `cap sync` and reapplies the
committed files below into the generated shell before building:

- `ios/App/Info.plist` — Capacitor plist baseline with the scaffolded display
  name substituted by `create-game`.
- `ios/App/Config/Signing.xcconfig` — automatic signing policy. Do not commit a
  team id; set `DEVELOPMENT_TEAM=<team id>` in the environment. `verify-device`
  passes that value to `xcodebuild` with `-allowProvisioningUpdates`.
- `android/app/src/main/res/values/strings.xml` — Android app identity strings
  with the scaffolded app id and title substituted by `create-game`.

## Safe-area contract

The native shell stays full-bleed:

- `index.html` includes `viewport-fit=cover`.
- `capacitor.config.ts` pins `ios.contentInset: "never"` so WKWebView does not
  add automatic scroll-view padding.
- App markup/CSS consumes `env(safe-area-inset-top)` and
  `env(safe-area-inset-bottom)` wherever chrome approaches the status bar or
  home indicator.

The Find The Dog metrics readout proved this shell/env pipeline: the device
reported a bottom inset of `34px`. The defect was markup that did not consume the
env values, not Capacitor config. Do not compensate by changing native viewport
geometry or frozen gameplay constants; fix the app-layer padding/margins and
verify on device.
