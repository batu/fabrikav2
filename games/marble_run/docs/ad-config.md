# Marble Run — ad & SDK configuration (2026-07-24)

Source of truth for credentials: `games/marble_run/sdk_integration/` (publisher
sheet `Marble Run Info.xlsx` + `GoogleService-Info (1).plist`). Secrets live only
in the untracked `games/marble_run/.env`; this file records what is wired, not
the secret values.

## Identifiers

| What | Value |
| --- | --- |
| Bundle / package id (release) | `com.basegamelab.marblerun` |
| Apple ID | `6793860059` — **ours**, generated on our App Store Connect account, not supplied by the publisher (their sheet left the row blank; we filled it in and confirmed it) |
| Firebase project | `mable-run` (note the publisher's spelling) |
| Facebook app id | `4138472436283342` |
| AdMob app id (supplied, unused) | `ca-app-pub-2687326720221638~6588461200` |

The release bundle id is already what `capacitor.config.ts`, `android/app/build.gradle`,
and the iOS `PRODUCT_BUNDLE_IDENTIFIER` all carry — no change was needed, and it
matches the `BUNDLE_ID` inside `GoogleService-Info.plist`.

## AppLovin MAX ad units (third batch, 2026-08-03)

| Format | Unit id |
| --- | --- |
| Rewarded | `a530ac16c61b0899` (created 2026-08-03; publisher says live ~30 min after creation) |
| Interstitial | `ac793825199f97bd` (created 2026-08-03; same caveat) |
| Banner | not supplied (`VITE_APPLOVIN_ALLOW_PARTIAL_UNITS=true` keeps MAX running without it) |

These replace the 2026-07-24 pair (rewarded `d516d39f20c54af0`, interstitial
`e959cabdfd0981de`), which the publisher had created as **Rewarded Interstitial**
units — a format removed in MAX SDK 13.0.0, so SDK 13.5.1 rejects them at load
(see the block below). The publisher created the new units after receiving the
2026-08-03 evidence report. **Both new units load with real fill on the iOS
simulator** (iPhone 17 Pro Max, 2026-08-03): `interstitial loaded unit=…97bd`,
`rewarded loaded unit=…0899` — see
`evidence/2026-08-03-max-unit-format-proof/sim-console-new-units-loaded.log`.
The format blocker is resolved. Still pending: a physical-device run (fill +
actual render/show path) before calling ads done.

History of the two earlier batches: the first single id (bound to both slots as
a format probe) and the 2026-07-24 pair all failed the same way on device:

> **(2026-07-24 pair, device-verified 2026-07-27, Pixel 6a.)** Both ids —
> including the *new* interstitial `e959cabdfd0981de` — return
> `E AppLovinSdk: Unknown ad format: REWARDED_INTER` and `loaded:false`. They are
> both registered in the MAX dashboard as **rewarded interstitial** units, a
> format this integration never requests. Fixing this needs either standard
> Interstitial + Rewarded units from the publisher, or rewarded-interstitial
> support added to the native plugin. Evidence:
> `evidence/2026-07-27-ad-ids-remote-config/`.

AdMob remains the config-switched Android fallback in `packages/sdk`
(`selectAdProvider`) and is never selected while MAX is enabled. No AdMob unit
ids exist; its config falls back to Google's public test units.

## Interstitial policy (remote-config driven)

Publisher spec (Doğaç, 2026-07-24): ad-free early levels, then fail-only ads,
then ads at any level end — with two independently tunable cooldowns.

| Level number | Behaviour |
| --- | --- |
| `< interstitial_first_level` (10) | no interstitials |
| `10 … 19` | interstitial only after a **fail**, gated by `interstitial_fail_cooldown_s` |
| `>= interstitial_fail_only_until_level` (20) | interstitial after **win or fail**, gated by the matching cooldown |

Remote keys (Firebase Remote Config group **Ads**):

- `interstitial_ads_enabled` — master kill switch (default `true`)
- `interstitial_first_level` — default `10`
- `interstitial_fail_only_until_level` — default `20`
- `interstitial_fail_cooldown_s` — default `90`
- `interstitial_level_end_cooldown_s` — default `90`
- `rewarded_ads_enabled` — master switch for every rewarded placement (default `true`)

Both cooldowns are minimum seconds since the **last interstitial of any kind**,
which is the interval the ad provider already enforces (`maybeShowInterstitial({ minIntervalMs })`).
The policy decides whether to ask and with which interval; it holds no impression
state of its own.

Where it lives:

- `src/ads/interstitialPolicy.ts` — pure decision function, table-tested in
  `tests/unit/interstitial-policy.test.ts`.
- `src/ads/remoteAdPolicy.ts` — reads the remote values.
- `src/scenes/GameScene.ts` — win path (after the level-complete overlay closes)
  and fail path (on Retry, so the ad sits between the fail screen and the restart
  rather than over the fail beat).
- `rewarded_ads_enabled` also hides the win card's Claim ×2 action, so a disabled
  rewarded stack never shows a button that cannot pay out.

The superseded keys `interstitial_every_n_levels`, `interstitial_min_interval_s`,
and `interstitial_min_level` were removed — nothing had ever been published to a
console template, so there is no live parameter to strand.

## Remote Config transport

`RemoteConfigService` used to be a stub: it returned compiled defaults and
dev-only localStorage overrides, and **never fetched anything**. Nothing was
remotely adjustable.

It now fetches the Firebase Remote Config client endpoint directly over REST
(`firebaseremoteconfig.googleapis.com/v1/projects/mable-run/namespaces/firebase:fetch`)
using the project's API key + app id from `.env`. Chosen over
`@capacitor-firebase/remote-config` because it needs no new dependency and no
`google-services.json` (which the publisher has not supplied), and it runs
identically in the browser, on Android, and on iOS.

Behaviour: values resolve test-override → remote → compiled default. A successful
fetch is cached in localStorage and replayed at the next cold start, so a launch
with no network keeps the live values. Fetch failures are non-fatal and surface
in the SDK verifier pane's snapshot.

### Which Firebase project (changed 2026-07-27)

The publisher's project is **`mable-run`** (their spelling, not a typo here) and
the `baseardahan@gmail.com` account **cannot open it** — `firebase projects:list`
does not include it and `apps:list --project mable-run` fails on permissions.
That blocked both publishing a Remote Config template and downloading
`google-services.json`.

So Remote Config is now owned by **our** project, `marble-run-basegamelab`
(console: https://console.firebase.google.com/project/marble-run-basegamelab).
Both apps are registered under `com.basegamelab.marblerun`. Consequences:

- **Remote Config**: ours, publishable by us. `firebase deploy --only remoteconfig`
  from `games/marble_run/` (see `firebase.json`).
- **Android analytics**: now lands in our project —
  `native-resources/android-config/app/google-services.json` is overlaid onto
  `android/app/` by `sync-native-resources.mjs`, and `app/build.gradle` applies
  the google-services plugin only when that file exists. Before this, Android
  had no Firebase config at all and sent nothing anywhere.
- **iOS analytics**: still ships the publisher's plist, so it reports to
  `mable-run`. **Open decision** — either repoint iOS at our project (analytics
  in one place, but the publisher loses the iOS data they set up) or get access
  to `mable-run` and consolidate there.

**Live and device-verified (2026-07-27):** template published (62 parameters);
a remote change to `interstitial_first_level` (10 → 3 → 10) propagated to the
client; the Pixel's verifier pane reports `ready / fetch success / values remote`
(`evidence/2026-07-27-ad-ids-remote-config/pixel-remote-config-values-remote.png`).
Regenerate the template with
`UPDATE_REMOTE_CONFIG_TEMPLATE=1 npm run test:unit -w @fabrikav2/marble_run`;
a guard test fails if it drifts from the schema.

## How to verify on device

The gating logic and the fetch/coercion are covered by unit tests
(`tests/unit/interstitial-policy.test.ts`, `tests/unit/remote-config-fetch.test.ts`);
what tests cannot prove is **ad fill** and the **live config round trip**. Both
are reachable from the SDK verifier pane (4-tap gesture, or build with
`VITE_SDK_VERIFIER_AUTOMOUNT=true`):

1. `ads → Load interstitial` then `Show interstitial` — forces `minIntervalMs: 0`,
   so it bypasses the policy and answers only "does the corrected unit id fill?".
   This is the check that was blocked by the invalid unit id.
2. `ads → Load rewarded` / `Show rewarded` — same for the rewarded unit.
3. `remote config (ads) → Refetch config` — shows fetch status and the active
   gate values. While the console has no template it reports
   `no-template` with every value at its compiled default; after publishing it
   should report `success` with the console's values.

Note that the dev-only localStorage overrides (`ftd_remote_config_test_overrides`)
do **not** apply in a device build, so changing the gates for a device test means
publishing them to the console.

## SDK integration status

| SDK | Status |
| --- | --- |
| AppLovin MAX | Initialized on device (Pixel 6a, 2026-07-23), live mediation traffic. **Ad fill still unproven** — the previous unit id was invalid; re-test with the corrected ids. |
| AppsFlyer | Verified on device: provider selected, native `trackEvent` flowing. |
| Facebook Core | Verified on device: real POST to `graph.facebook.com/.../activities`. |
| Firebase Analytics | **Verified nowhere.** iOS on-device runtime is blocked on signing; Android has no `google-services.json` so nothing can reach the project natively. Remote Config (above) is independent of the plugin and does work. |

### Correction to the 2026-07-23 evidence doc

That doc states the Firebase plugin is "excluded from the Android build" without
`google-services.json`. It is not: `src/sdk/includePlugins.ts` gates on the
**`VITE_FIREBASE_*` env triple**, which is present, so
`@capacitor-firebase/analytics` ships in the Android APK (confirmed in the
2026-07-24 `cap sync android` plugin list). It does not crash at boot — but with
no `google-services.json` it has no native Firebase project to send to, so
Android analytics events go nowhere. Getting Android Firebase working needs the
publisher to supply `google-services.json` for `com.basegamelab.marblerun`; the
iOS plist alone is not enough.

Details and capture hashes: `evidence/2026-07-23-sdk-integration-evidence.md`.
