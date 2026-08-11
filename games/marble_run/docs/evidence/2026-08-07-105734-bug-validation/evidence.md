---
status: partial
subject: Marble Run workbook and conversation bug validation
created: 2026-08-07
mode: pipeline
---

# Evidence: Marble Run bug validation

## Verdict

The current commit passes every required automated check and its signed normal build launches on Batu's iPhone 12, but the validation is partial: static device states and native SDK handoffs are proven, while interaction and final-ball motion claims remain unobserved, ATT is already authorized, and dashboard ingestion is inaccessible.

## Build Identity

- Branch: `work/marble-run`
- Commit: `59a37bcec468012ba003ccca348fd0c5f9ba100e`
- Device: Batu's iPhone 12 (`iPhone13,2`)
- Hardware UDID: `00008101-000410EC3EF9001E`
- CoreDevice identifier: `2D894791-A5A3-58BE-9C88-AE0AF08B8C09`
- Bundle ID: `com.basegamelab.marblerun`
- Normal Debug artifact: `/private/tmp/marble-run-validation-derived-data/Build/Products/Debug-iphoneos/App.app`
- Initial normal app executable SHA-256: `d1cbdd3a8a60cdafdd9b0181cf10615c2ac4377c37a8e1ebdae20fd3cff91246`
- The app was deleted, freshly installed, cold-launched with console capture, then replaced temporarily by the verifier harness. The normal non-harness build was rebuilt and reinstalled at the end. See `assets/build-identity.txt`, `assets/uninstall-install.log`, `assets/cold-launch-console.log`, `assets/restore-normal-app.log`, and `assets/final-installed-build-identity.txt`.

## Automated Checks

| Check | Status | Evidence |
|---|---|---|
| `npm run test:unit` | PASS | 48 files passed; 904 passed, 1 skipped; `assets/test-unit.log` |
| `npm run typecheck` | PASS | exit 0; `assets/typecheck.log` |
| `npm run lint` | PASS | exit 0; `assets/lint.log` |
| `npm run build` | PASS | production build completed; chunking warnings only; `assets/build.log` |
| `npm run ios:sync` | PASS | Capacitor sync, native-shell apply/validate, team injection, and resource sync passed; `assets/ios-sync.log` |
| Signed device build | PASS | `** BUILD SUCCEEDED **`; `assets/xcodebuild.log` |
| Canonical iPhone capture lane | AUTOMATED ONLY | Six marker-gated physical screenshots captured. Overall verifier verdict is `UNVERIFIED` because the paid vision panel was deliberately skipped; advisory phash differed from historical references. `assets/verify-device/` and `assets/verify-device-retry.log` |

The first verifier attempt failed before installation because its generated Xcode project lacked a development team. The documented `DEVELOPMENT_TEAM=42L77JAX72` environment value corrected the lane; no product source was changed.

## Validation Matrix

| Area | Status | Current evidence and boundary |
|---|---|---|
| Cold launch: first Home paint timing | PASS | Fresh physical install, cold launch, native console: `js-entry 57 ms`, `viewport-stable 392 ms`, `home-scene-create 916 ms`, `home-first-paint 989 ms`. This is below the reported ~5 seconds. `assets/cold-launch-console.log` |
| Cold launch: no background-only shell | BLOCKED | The current normal build reached `HomeScene` and logged first paint, and the same commit's harness later produced a complete physical Home screenshot. A screenshot of the exact normal cold-launch interval was not captured because the DVT screenshot tunnel was unavailable without the privileged tunnel daemon. This is not promoted to PASS. |
| Final-ball entry-point lifecycle | AUTOMATED ONLY | Gate-lifecycle unit coverage passes, but no current physical recording or timed frame sequence was obtained. Motion is unverified. |
| Workbook 1: Level 13 tap targeting | AUTOMATED ONLY | Regression tests pass; Level 13 was not physically driven and tapped at the visibly moving marble. |
| Workbook 2: long-press selection/callout suppression | AUTOMATED ONLY | Global suppression regression tests pass; no physical long-press interaction was observed. |
| Workbook 3: native image/modal dragging suppression | AUTOMATED ONLY | Global drag suppression tests pass; no physical drag interaction was observed. |
| Workbook 4: first-level tutorial alignment | PASS | Marker-gated physical Level 1 capture shows the hand and spotlight centered on the currently rendered blue marble. Inspected full frame and `assets/tutorial-zoom.png`; source is `assets/verify-device/raw-captures/level.png`. Tracking across motion was not separately recorded. |
| Workbook 5: ATT first-launch prompt | BLOCKED | Fresh install resolved ATT status `3` (authorized). iOS does not return this phone/profile to undetermined by reinstalling the app, so first-prompt behavior cannot be observed on this device state. `assets/native-handoff-sanitized.log` |
| Menu settings: static layout | PASS | Physical capture shows an uncropped wide orange ribbon masking the panel top, centered `SETTINGS`, centered X at the top-right, no bottom Close button, inset readable labels, and three consistent switches. `assets/verify-device/raw-captures/settings.png` |
| Menu settings: X pressed state, dismissal, toggle geometry/state changes | AUTOMATED ONLY | Geometry and behavior tests pass, but current physical interaction evidence was not captured. |
| In-game settings: static layout | PASS | Physical capture shows the shared ribbon/X/labels/switches, vertical separation, and compact Restart/Home actions inside the panel. Labels remain readable with the intended offset outline. `assets/verify-device/raw-captures/pause.png` and `assets/pause-actions-zoom.png` |
| In-game settings: Restart, Home, X dismissal, and toggle changes | AUTOMATED ONLY | Unit coverage passes; the current physical action results were not observed. |
| Hint at 224 coins: disabled/muted | PASS | The physical Level 1 state has 25 coins and shows the unaffordable hint visibly muted, proving the below-225 state on phone. `assets/verify-device/raw-captures/level.png` and `assets/hint-zoom.png` |
| Hint at exactly 225+: enabled/full-color/readable | AUTOMATED ONLY | Boundary, opacity, artwork-filter, and label styling tests pass; no current physical 225-coin capture was obtained. |
| Hint use deducts 225 without gameplay regression | AUTOMATED ONLY | Controller/HUD tests pass; the physical deduction flow was not observed. |
| Firebase native handoff | PASS | Fresh physical launch recorded multiple `To Native -> FirebaseAnalytics logEvent` calls followed by `TO JS undefined`, proving Capacitor bridge completion. `assets/native-handoff-sanitized.log` |
| Firebase dashboard ingestion | BLOCKED | The user has no Firebase DebugView/dashboard access. Native handoff does not prove backend ingestion. |
| AppsFlyer native handoff | PASS | Fresh physical launch recorded initialization completion, SDK start, `appOpen` track completion, and native `event logged name=appOpen`. `assets/native-handoff-sanitized.log` |
| AppsFlyer dashboard ingestion | BLOCKED | No AppsFlyer dashboard credentials/access were available in this validation session. Native handoff does not prove backend ingestion. |

## Visual Inspection

All six raw physical captures were opened and inspected: `menu.png`, `level.png`, `settings.png`, `pause.png`, `win.png`, and `fail.png`. The settings actions, hint, and tutorial target were additionally cropped from the full-resolution originals and inspected as `assets/pause-actions-zoom.png`, `assets/hint-zoom.png`, and `assets/tutorial-zoom.png`.

The canonical verifier captured all six states with live-device provenance and marker gating. Its overall status remains `UNVERIFIED`, not PASS, because no paid vision-panel calls were authorized and `--skip-panel` was used. Its advisory historical-reference phash reported four over-threshold states; that is a reference-fidelity result, not proof that any workbook defect reproduced.

## Analysis

No workbook defect was directly reproduced as a physical-device failure in this run. That does not make the unobserved defects fixed. The missing proof is concentrated in physical interactions and motion: Level 13 targeting, long-press, dragging, toggle/action behavior, the exact 225-coin hint transition, hint deduction, and the final-ball entry-point sequence.

The direct screenshot route failed twice: USB discovery did not expose the iOS 17+ DVT service, and the privileged `pymobiledevice3` tunnel daemon was not running; non-interactive sudo was unavailable. The canonical XCUITest lane recovered static physical evidence, but it does not record arbitrary interaction sequences or the final-ball motion scenario.

## Gaps

- No physical recording of the final-ball entry-point lifecycle.
- No physical Level 13, long-press, drag, toggle, Restart/Home, or exact-225 hint interaction evidence.
- No undetermined ATT authorization state.
- No Firebase or AppsFlyer dashboard access.

## Next Action

Run one instrumented physical interaction session with screen recording enabled (or an authorized privileged DVT tunnel), covering Level 13, long-press, modal dragging, settings actions/toggles, 224→225 hint behavior/use, and the multi-ball final-entry sequence; separately obtain provider dashboard access if ingestion must be classified beyond BLOCKED.
