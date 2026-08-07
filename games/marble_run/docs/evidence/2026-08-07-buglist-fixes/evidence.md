# Marble Run bug-list fixes — verification evidence

Status: **partial**

Date: 2026-08-07

Source: `refs/bugs/Marble Run-BUGLIST.xlsx`

## Implemented behavior

- Input targeting and the first-level tutorial cue now project the current rendered marble position, including board settle/drop motion.
- Text selection, iOS touch callouts, and native image dragging are disabled across the game surface.
- Remote Config refresh starts in the background instead of blocking the first Home scene paint.
- Analytics initialization now runs during bootstrap, enabling the session event path.
- The native AppsFlyer bridge requests ATT authorization when the status is undetermined.

## Automated verification

The regression tests were first run against the previous implementation and failed for the missing policies/behavior:

- global iOS selection and drag suppression: 3 failures
- moving tutorial projection: expected `124px`, received `100px`
- analytics bootstrap initialization: expected one call, received zero

After implementation:

```text
Focused regressions: 3 files, 12 tests passed
TypeScript typecheck: passed
Lint: passed
Unit suite: 47 files passed; 896 passed, 1 skipped (897 total)
Production web build: passed
git diff --check: passed
```

## Physical iPhone verification

Device: iPhone 12 (`2D894791-A5A3-58BE-9C88-AE0AF08B8C09`)

```text
Xcode Debug-iphoneos build: ** BUILD SUCCEEDED **
Install com.basegamelab.marblerun: succeeded
Launch with device console attached: succeeded
FirebaseAnalytics logEvent bridge calls shortly after WebView load: 2 observed
AppsFlyer initialization: observed
AppsFlyer appOpen native log: observed
ATT authorization status: 3 (already authorized)
```

### Startup regression correction

The first optimized build displayed only the purple shell background. Device console showed the WebView and Phaser loading without reaching the menu. Phaser sets a scene to `RUNNING` only after its `create()` method returns; the synchronous BootScene transition checked `sys.isActive()` while the scene was still `CREATING` and returned permanently.

A lifecycle regression test now reproduces that ordering. BootScene defers the transition by one microtask, retaining the non-blocking Remote Config startup while allowing Phaser to activate the scene. The test failed before the correction and passed afterward.

The canonical physical-iPhone capture lane then produced a gated `menu` screenshot showing the complete Marble Run home screen. Its overall exploratory run remained `UNVERIFIED` because later tour states had missing/indistinguishable markers and the vision panel was intentionally disabled; that does not invalidate the captured startup/menu state. The normal, non-harness build was subsequently rebuilt, installed, and launched on the same iPhone.

### First-install startup optimization

Fresh-install measurements were taken by uninstalling the app, installing the newly built artifact, and launching with the device console attached. `performance.now()` markers covered JavaScript entry, viewport stabilization, bootstrap evaluation, Phaser creation, BootScene, HomeScene, and the first menu paint.

```text
Baseline first menu paint:                4355 ms
Deferred decorative board preview:        3309 ms  (-1046 ms, -24%)
Canvas renderer experiment:                687 ms
Permanent Canvas renderer verification:   691 ms  (-3664 ms, -84% vs baseline)
```

The baseline spent about 2.6 seconds between Phaser construction and BootScene because `Phaser.AUTO` selected a second WebGL renderer. Marble Run's actual 3D board already owns a separate Three.js WebGL canvas; Phaser only paints lightweight shell/vignette primitives. Using Phaser Canvas removes that redundant cold WebGL context. The decorative Three.js home preview now mounts after the DOM shell gets its first paint instead of blocking it.

The canonical iPhone lane captured gated menu, level, settings, pause, win, and fail states with the Canvas-backed Phaser build. Menu, gameplay/tutorial, and win captures were opened and visually inspected. The run remains `UNVERIFIED` as a full fidelity verdict because the vision panel was disabled and settings/pause were flagged as indistinguishable; the physical captures themselves succeeded.

The device log proves the fixed build reached both native analytics bridges. It does not prove that either provider dashboard has ingested and displayed those events.

## Workbook acceptance status

1. Level 13 tap offset — code and regression coverage complete; physical Level 13 interaction not captured.
2. Long-press selection — global prevention implemented and tested; physical long-press interaction not captured.
3. Draggable windows — native image dragging disabled globally and tested; physical modal drag interaction not captured.
4. Tutorial target offset — live-position projection implemented and tested across animation frames; physical first-level capture not recorded.
5. Missing ATT prompt — native request path compiled and installed; prompt cannot be observed on this device because authorization is already granted. A reset/clean device is required.
6. Five-second first launch — blocking Remote Config wait removed and device launch succeeded; precise first-visible-frame timing was not recorded.
7. Missing AppsFlyer/Firebase events — native event handoff observed for both SDKs; dashboard arrival remains an external verification gate.

## Remaining acceptance work

Run a physical interaction capture covering Level 13, long-press behavior, modal dragging, and first-level tutorial alignment. Verify ATT on a device/simulator with undetermined tracking status, measure cold first paint, and confirm events in the Firebase and AppsFlyer dashboards.
