# Device evidence — corrected ad ids + Remote Config (2026-07-27)

Device: Pixel 6a `27091JEGR22183`, Android 16, real hardware. Build installed
with `adb install -r` over the 2026-07-24 debug build — **no uninstall, no data
wipe**; the debug keystores match.

Build identity asserted before every install: `dist/index.html` hash ==
`assets/public/index.html` inside the APK.

## Verified good

- **Boot + home**: clean launch, saga map intact — `pixel-home-boot.png`.
- **SDK verifier pane**, 5 integrations — `pixel-sdk-verifier.png`:
  - ads: `provider: applovin-max`
  - attribution: `provider: appsflyer`
  - firebase analytics: `sink attached (firebase)` (JS-level; see the Android
    caveat in `docs/ad-config.md`)
  - facebook: `initialized`
- **Remote Config transport works on device** —
  `pixel-remote-config-fetch-success.png`:
  `ready / fetch success / values default — No Remote Config template published
  for this project.` The client reaches the real `mable-run` project from the
  phone; every value is a compiled default until a template is published.

## The blocker: BOTH publisher unit ids are REWARDED_INTER

`Show interstitial` returned `shown=false`
(`pixel-activity-log-shown-false.png`). Logcat (`applovin-logcat.txt`):

```
preloadRewarded      {"adUnitId":"d516d39f20c54af0"}  → E AppLovinSdk: Unknown ad format: REWARDED_INTER → {"loaded":false}
preloadInterstitial  {"adUnitId":"e959cabdfd0981de"}  → E AppLovinSdk: Unknown ad format: REWARDED_INTER → {"loaded":false}
```

The 2026-07-23 session found this for the single old id and assumed a proper
rewarded/interstitial pair would fix it. **It does not.** The new interstitial id
`e959cabdfd0981de` is *also* registered in the AppLovin dashboard as a
**rewarded interstitial**, a format this integration never requests (it asks for
INTERSTITIAL and REWARDED). No ad can fill until one of:

1. the publisher creates a standard **Interstitial** unit and a standard
   **Rewarded** unit in the MAX dashboard and sends those ids, or
2. we add rewarded-interstitial support to the native plugin
   (`MaxRewardedInterstitialAd` / `MARewardedInterstitialAd`), which is a real
   plugin change on both platforms, not a config edit.

Corrected ids are wired and reach the SDK — the `adUnitId` values in the bridge
calls above prove the plumbing is right. The remaining failure is entirely on
the dashboard's unit format.

## Still unverified

- Ad fill / render (blocked above).
- Firebase event delivery anywhere (Android has no `google-services.json`).
- iOS runtime (signing).
