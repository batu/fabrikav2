# Marble Run — ad & SDK configuration (2026-07-24)

Source of truth for credentials: `games/marble_run/sdk_integration/` (publisher
sheet `Marble Run Info.xlsx` + `GoogleService-Info (1).plist`). Secrets live only
in the untracked `games/marble_run/.env`; this file records what is wired, not
the secret values.

## Identifiers

| What | Value |
| --- | --- |
| Bundle / package id (release) | `com.basegamelab.marblerun` |
| Apple ID | `6793860059` |
| Firebase project | `mable-run` (note the publisher's spelling) |
| Facebook app id | `4138472436283342` |
| AdMob app id (supplied, unused) | `ca-app-pub-2687326720221638~6588461200` |

The release bundle id is already what `capacitor.config.ts`, `android/app/build.gradle`,
and the iOS `PRODUCT_BUNDLE_IDENTIFIER` all carry — no change was needed, and it
matches the `BUNDLE_ID` inside `GoogleService-Info.plist`.

## AppLovin MAX ad units (corrected 2026-07-24)

| Format | Unit id |
| --- | --- |
| Rewarded | `d516d39f20c54af0` |
| Interstitial | `e959cabdfd0981de` |
| Banner | not supplied (`VITE_APPLOVIN_ALLOW_PARTIAL_UNITS=true` keeps MAX running without it) |

This supersedes the earlier state where the single publisher-supplied id was
bound to both slots as a format probe; that id resolved to `REWARDED_INTER` and
every request failed with `invalid_or_disabled_ad_unit_id`. Both ids are now set
for iOS and Android in `.env`, and both are present in the built bundle.

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

**Live run (2026-07-24):** the client reaches the real project and classifies the
response as `no-template` — authentication works; **no Remote Config template has
been published in the `mable-run` console yet**, so every value is still the
compiled default. Upload `docs/remote-config-template.json` (regenerate with
`UPDATE_REMOTE_CONFIG_TEMPLATE=1 npm run test:unit -w @fabrikav2/marble_run`) to
make the parameters live; a guard test fails if that file drifts from the schema.

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
