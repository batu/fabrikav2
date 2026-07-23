# SDK Integration Device Evidence — 2026-07-23

Card: AppsFlyer + Firebase + Facebook + MAX as `packages/sdk` components, wired
into marble_run (real credentials) and shell_template (placeholders), with the
SDK verifier pane as the capture surface. Device: Pixel 6a (27091JEGR22183),
real hardware, Android 16.

## Verified (observed on device)

- **SDK verifier pane** live at boot (automount build): per-SDK status,
  configured ids (secrets redacted), action buttons, timestamped callback log.
  `sdk-verifier-android-boot.png` (sha1 1332536443b851b146db8d6e8a5949bfb8593dd5).
- **AppLovin MAX**: SDK initialized with the publisher key (redacted tail wBUP);
  logcat shows live `rt.applovin.com` / `ms4.applovin.com/1.0/mediate` traffic.
  After the mediation-provider fix, `Mediation provider is null` is gone.
- **Unit id identified**: AppLovin rejects `d516d39f20c54af0` for interstitial
  and rewarded requests with `source=invalid_or_disabled_ad_unit_id` and logs
  `Unknown ad format: REWARDED_INTER` — the publisher's single unit is a
  **rewarded interstitial**, a format the integration does not yet request.
  Publisher follow-up: standard interstitial + rewarded unit ids (or a decision
  to add rewarded-inter support).
- **AppsFlyer**: provider selected (`appsflyer`), native `trackEvent` flowing
  (`appOpen` with cohort_bucket seen in logcat via the Capacitor bridge).
- **Facebook Core**: initialized programmatically with app id 4138472436283342;
  logcat shows a real POST to `graph.facebook.com/v16.0/4138472436283342/activities`.
- Action-log capture: `sdk-verifier-android-actions.png`
  (sha1 d5f816245ae4931baed12dacb47ef6a567de56da); ad-load attempt capture:
  `sdk-verifier-android-adloads.png` (sha1 774ea6a7027ac0d1f7abd24892e7b25a149db683).
- **shell_template placeholder mode**: boots on the same device with every SDK
  in a first-class not-configured state (reasons shown), no crash — the Firebase
  crash-at-boot guard holds. `games/shell_template/evidence/sdk-verifier-android-placeholder.png`
  (sha1 631419c95d78e03e70516e1234bb0edbaf1b5891).

## Builds (compile-level proof, all green)

- marble_run iOS simulator: BUILD SUCCEEDED (all four Swift plugins compiled,
  SPM graph resolved: AppLovin 13.6.x, AppsFlyer 6.18.1, facebook-ios-sdk,
  Firebase local package).
- marble_run Android: BUILD SUCCESSFUL (AppLovin/AppsFlyer/Facebook deps +
  Java bridges + MainActivity registration).
- shell_template iOS simulator: BUILD SUCCEEDED; shell_template Android:
  BUILD SUCCESSFUL (fresh `cap add android`).

## UNVERIFIED (declared gaps)

- **iOS on-device runtime**: xcodebuild device signing fails in this
  environment — the auto provisioning profile lacks the In-App Purchase
  capability and no Xcode account session is available
  (`No Accounts` / `doesn't include the In-App Purchase capability`).
  Needs Batu's Xcode account (or a profile for com.basegamelab.marblerun),
  then: `VITE_SDK_VERIFIER_AUTOMOUNT=true npm run build && npm run ios:sync`
  and a device install; the pane automounts for capture.
- **Firebase on Android**: publisher supplied only the iOS plist; without
  `google-services.json` the native plugin is excluded from the Android build
  (includePlugins guard). The pane's firebase row on Android reflects the JS
  env gate, so its "sink attached" overstates Android native truth — Firebase
  event delivery is verified nowhere yet (DebugView check pending on iOS).
- **Ad render**: no fill/show observed — blocked on correct-format unit ids
  from the publisher (see REWARDED_INTER finding).
- **ATT / consent flows on iOS** (AppsFlyer ATT wait, FB advertiser tracking,
  MAX consent flow): iOS-runtime behaviors, blocked with iOS on-device.

## verify-device Android lane attribution (added after control runs)

Five verify-device runs on the Pixel 6a established:
1. Tool infra bug fixed: `spawnSync adb ENOBUFS` (screenshot > Node's 1MB spawn
   buffer) — 64MB maxBuffer added to `tools/verify-device/src/command.mjs`.
2. Diff bug found & fixed: AppLovin "Missing Privacy Policy URL" debug dialog
   overlaid all tour states (median 27.5%). Fix: legal URLs in `.env` (+example)
   and a fail-safe in `AppLovinMaxPlugin.java` (missing privacy URL disables the
   consent flow; the iOS recipe already guarded this).
3. GDPR consent dialog (correct product behavior) blocks the automated tour;
   parity runs therefore execute with `VITE_APPLOVIN_*_ENABLED=false`
   (references predate ads).
4. CONTROL: HEAD fails the 85% floor identically (median 75, level 35) to the
   diff run (median 71, level 20) — the android reference set (authored on the
   Linux host) is stale for this lane; failure is PRE-EXISTING, not caused by
   the SDK integration. Re-baselining is an improvement-plan item (needs visual
   sign-off). Fresh artifacts: docs/evidence/2026-07-23-device-verify/.
