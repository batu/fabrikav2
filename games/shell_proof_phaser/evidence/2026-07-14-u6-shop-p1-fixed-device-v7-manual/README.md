# U6 Shop P1 physical-device close-out

Target: Pixel 6a `27091JEGR22183`, Android WebView, explicit Phaser WebGL.

- Accepted publication B: `sha256-9b380659304aad012337a0e6a75a815c6d0a419f1116c04c1cf4e29de98c2980`
- Selected projection: `sha256-8f2a0286b74bff896ddb760fd1d41360d31d727cbea64bb039622fb4b6aedd97`
- Projection chain: P0 `445b3929…` → A `d88079ef…` → B `8f2a0286…` → B no-op
- Device build: Vite production build, Capacitor Android sync, Gradle debug APK, ADB install and launch all completed before capture.

The normal `verify-device` run built and installed successfully but Android's
`uiautomator dump` intermittently crashed with an already-registered
`UiAutomationService`. To avoid misrepresenting that partial run, this folder
contains a fresh explicit fallback: each canonical state was driven through the
installed WebView's real `__SHELL_PROOF_PHASER_HARNESS__.driveTo` entry point,
gated on the live evidence probe (`state`, `ready`, and exact projection),
then captured with physical-device ADB `screencap`.

All seven state snapshots report `reached: true`, `ready: true`, and revision
`8f2a0286…`. The Shop capture now contains only Coin Pack and No Ads; the VIP
Bundle, locked third card, and trophy are absent. The other six screens remain
distinct and reachable. `raw-captures/` preserves full 1080×2400 device frames;
`judged-captures/` removes a 96 px status/debug-overlay inset and 96 px navigation
inset; both are outside the 390×844 game canvas. `snapshots/` binds each image to
its live controller and probe state.

This is physical-device reachability, identity, and state-integrity evidence.
There are still no trusted reference images, so it is not a visual-fidelity PASS.
