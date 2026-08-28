# Find games measurement readiness

Date: 2026-08-28
Branch: `feat/ftb-appsflyer-crashlytics`

## Verified

- Dedicated Firebase app identities read back from Firebase CLI for both exact bundles.
- Owner Firebase plists are mode `0600`, ignored, and validated for bundle, project, and app identity.
- Both iOS native shells deterministically select `AppsFlyerFramework-Strict` / `AppsFlyerLib-Strict` and Crashlytics; Adjust and Firebase Analytics products are absent from the manifest graph.
- AppsFlyer partner sharing defaults to deny-all and is applied before `start()`.
- Both physical-device Debug builds compile and sign on the iPhone 12 target.
- Find The Bird was installed and launched through the canonical harness. The inspected device capture is `device-ftb/raw-captures/menu.png`.
- Find The Dog was installed and launched on the same physical iPhone 12.

## Release gates preserved

- AppsFlyer partner allowlist: empty.
- Meta/Google/Apple partner forwarding: not enabled.
- Campaign delivery/spend: not enabled.
- App Store submission/release: not performed.
- Production game release: not performed.

## External blockers

- The AppsFlyer account exposes no repository/API readback credential suitable for authoritative event-receipt verification. The owner-only developer key is an SDK key, not a management/reporting API token. Backend event receipt remains unverified.
- The existing game verifier UI does not mount the shared deliberate-crash action. No controlled Crashlytics crash was triggered, so Firebase issue receipt and symbolication remain unverified.
- `otool -L` shows `AdSupport` and `AppTrackingTransparency` in both final app binaries through the existing AdMob dependency graph. The strict AppsFlyer product is selected, but the plan's whole-binary no-AdSupport gate is not met.
- The canonical FTB harness installed and captured the live app, but its marker-driven state tour failed and produced blind captures. The inspected menu capture proves launch/render only, not the complete requested runtime sequence.

These blockers keep partner activation and merge closed.
