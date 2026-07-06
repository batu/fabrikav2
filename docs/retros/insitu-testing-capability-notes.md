# In-situ / device testing capability ledger (live)

Batu will ask for a lot of on-device and reference-comparison verification; this
tracks what works today vs what's missing, feeding a future test-harness card.
Started 2026-07-06 during the v1↔v2 marble_run comparison.

## Works today

- **Harness-driven browser capture**: games expose `window.__<GAME>_HARNESS__`
  (gotoMenu/startLevel/solveStep/snapshot) on dev builds; playwright scripts in
  the game's `.work/` drive it and screenshot deterministic states. Fast, reliable.
- **Side-by-side v1↔v2 reference capture**: run v1's dev server (read-only) and
  v2's on separate ports, same viewport, same script → comparable PNGs. Found
  the camera/chrome/saga regressions in minutes.
- **Conductor visual review of PNGs**: reading screenshots directly catches
  layout/theme regressions that unit tests can't express.
- **Device build+install+launch**: xcodebuild (`-project`, SPM Capacitor) +
  `devicectl install/launch`, keychain via .env password. Playbook codified
  (retro F14); second build was one pass.
- **e2e with real assertions**: menu-boot + play-to-terminal via harness, green
  in CI-like runs.

## Doesn't work / missing (the harness wishlist)

1. **On-device screenshots/screen recording**: no wired path. `devicectl` can't
   screenshot directly; options to evaluate: `xcrun simctl` (sim only), iOS
   ReplayKit hooks in a debug menu, or WebView-side self-capture (canvas/DOM →
   PNG POSTed to a local endpoint). Needed for "in situ phone comparison".
2. **Real-input testing on device**: no XCUITest target; taps can't be driven
   on the phone. The dead-menu-buttons bug (real clicks fail, JS clicks pass)
   was invisible to the harness path — REAL-CLICK e2e in browser is now
   mandated on the fidelity card, but on-device input remains unverified.
3. **Harness shortcuts mask input bugs** (the big lesson): driving
   `startLevel()` directly bypasses the entire input path. Rule: every user-
   visible control needs at least one no-force real-click test; harness calls
   are for state setup, not interaction coverage.
4. **Reference comparison isn't automated**: I hand-ran twin capture scripts.
   Wishlist: `tools/compare-capture --ref <url> --new <url> --script <flow>`
   producing a before/after grid + pixel-diff heatmap, promotable to evidence/.
5. **No visual-regression baseline**: screenshots aren't compared build-to-build;
   a broken theme ships silently unless a human looks. Wishlist: store blessed
   PNGs per screen in tests/e2e/__screenshots__, diff in CI with threshold.
6. **Device logs**: not wired (devicectl log stream exists; nobody consumes it).
   Needed to debug on-device-only failures (e.g. if the pointer bug had been
   device-only).
7. **WebView vs Safari divergence**: dev-server testing runs desktop Chromium;
   the phone runs WKWebView. No WKWebView-engine test lane exists (playwright
   webkit is close but not identical; real divergences will slip).

## Harness-card sketch (when Batu green-lights)

One `packages/testkit` extension + one tools/ CLI:
- testkit: `registerInsituHarness(app)` standard (already de-facto), plus a
  self-capture endpoint (debug builds POST canvas+DOM composite PNGs).
- tools/compare-capture: twin-URL scripted capture → grid + diff (item 4).
- XCUITest thin target in the template's generated shell for real-tap smoke on
  device (item 2), run manually via the F14 playbook.
- CI visual baseline for the ui package + each game's 5 canonical screens
  (item 5).
