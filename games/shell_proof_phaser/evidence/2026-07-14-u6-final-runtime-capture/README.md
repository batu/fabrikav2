# U6 final visual-runtime evidence

Contract: `visual-runtime`

Verdict: `passed` for editor publication/application identity, live Phaser
interaction, renderer readiness, and physical-device reachability. This is not
a visual-fidelity verdict because no trusted reference image is configured.

## Build and target

- Runtime commit: `cb19dcd83b525d780596cb2ce4b6fc2452ed6e35`
- Accepted publication B: `sha256-9b380659304aad012337a0e6a75a815c6d0a419f1116c04c1cf4e29de98c2980`
- Selected projection: `sha256-8f2a0286b74bff896ddb760fd1d41360d31d727cbea64bb039622fb4b6aedd97`
- Device: Pixel 6a `27091JEGR22183`
- Package: `com.fabrika.shellproofphaser`
- Build/install: Vite production build, Capacitor Android sync, Gradle debug
  APK, ADB streamed install, and launch completed on the target.

## Observations

- `pixel6a-playthrough.mp4` is a 7.997 second physical-device ADB
  screenrecord of Menu → Level → Win pre-claim → Win post-claim.
- The four sampled frames preserve the same sequence and were reviewed by the
  required independent game-aesthetics reviewer.
- The previously observed recorder black-frame corruption is absent after the
  renderer preserved its WebGL drawing buffer.
- Both exact Phaser Editor font aliases are loaded before runtime readiness;
  the sampled device frames use the bundled Kenney faces rather than fallback
  serif text.
- The reviewer returned a clean canonical findings block. The small green
  `100` at the top is a device refresh-rate overlay outside the app canvas.

## Automated checks

- Proof game typecheck and lint passed.
- Proof game unit suite passed: 11 files, 95 tests.
- Playwright passed 2/2, including exact loaded-font registrations,
  `preserveDrawingBuffer=true`, four distinct beats, symmetric pre/post-claim
  action visibility, and live Phaser hit rectangles.
- The preceding final repair chain also passed Phaser-shell typecheck, lint,
  validation, 216 tests, publication validation, and P0 → A → B → B no-op.

## Remaining release gates

- Same-human timed authoring comparison between GrapesJS and Phaser Editor.
- Trusted visual references and scored fidelity.
- Production signing/trust, operational rollback, purchases, and iOS proof.

