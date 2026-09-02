# Find games Google Play closed-test source preparation

Date: 2026-09-02
Branch: `feat/find-games-google-play`
Worktree: `/Users/base/dev/appletolye/fabrikav2/.worktrees/find-games-google-play`

## Status

Source preparation is complete within the sparse worktree. No Play, Firebase, RevenueCat, AppsFlyer, AdMob, or other provider account was created or changed. Nothing was uploaded, published, pushed, or merged. No physical Android verification was performed and no AAB was produced.

Production package identities are:

- Find the Dog: `com.basegamelab.findthedog`
- Find the Bird: `com.basegamelab.findthebird`

## Completed

- Android native commerce selects RevenueCat with a canonical `goog_` public SDK key. Production native Android throws when the key is absent or malformed; fake commerce remains limited to non-production/non-native surfaces and no longer reports itself as iOS.
- Android ads select the bundled Capacitor AdMob provider from `VITE_ADMOB_ANDROID_*`. The environment and Google Play validators require complete, non-sample app/banner/interstitial/rewarded IDs. AppLovin is not selected on Android. iOS AdMob behavior remains intact.
- AppsFlyer configuration now permits Android, remains deny-all for direct partner sharing, and uses game-specific native Java bridges adapted from Marble Run. Each generated `MainActivity` registers `AppsFlyerAttributionPlugin`. Direct Meta events remain off and no Meta native plugin was added.
- Each game has a committed Android overlay with exact package resources, protected version/signing seams, AppsFlyer dependency, AdMob manifest metadata, launcher density assets, and adaptive icons generated from its approved iOS app icon.
- `FIREBASE_ANDROID_CONFIG_PATH` materializes `google-services.json` only after exact package validation. When Crashlytics is enabled, the apply lane also adds the required root Gradle classpath and app Gradle plugin from the installed `@capacitor-firebase/crashlytics` setup. Missing, mismatched, or unapplied configuration fails closed.
- Durable `android:add`, `android:sync`, `android:validate-source`, `android:validate`, and `android:release` scripts now exist for both games. `android:validate-source` checks the committed recipe before generation; `android:validate` requires and inspects the generated/applied project. The release lane requires protected version, provider, signing, and signer-certificate inputs.
- Production validation requires AppsFlyer as the selected attribution provider and rejects Android AdMob test mode/device IDs plus test-harness, verifier-autocrash, tour, simulation, and dev-shell leakage.
- Exact-AAB inspection verifies strict JAR signing, the expected upload-certificate SHA-256, package, versionCode, versionName, and non-debuggable manifest state through bundletool.
- Find the Dog stale Play URL and `.dev` Capacitor identity were replaced. Find the Bird Play metadata now uses its own package.

## Tests and checks

Passing:

```sh
npm run test:unit -w @fabrikav2/find_the_dog
# 41 files, 283 tests

npm run test:unit -w @fabrikav2/find_the_bird -- --exclude tests/unit/five-square-campaign.test.ts --exclude tests/unit/restoration-cleanup-geometry.test.ts
# 60 files, 345 tests

npm run test:unit -w @fabrikav2/sdk
# 38 files, 337 tests

npm run test:unit -w @fabrikav2/native-shell
# 1 file, 12 tests

npx vitest run --root tools/google-play test/release.test.mjs
# 1 file, 23 tests

npx vitest run --root tools/game-env test/game-env.test.mjs
# 1 file, 39 tests

npm run typecheck -w @fabrikav2/find_the_dog
npm run typecheck -w @fabrikav2/find_the_bird
npm run lint -w @fabrikav2/find_the_dog -- --quiet
npm run lint -w @fabrikav2/find_the_bird -- --quiet
git diff --check
```

TDD red evidence observed before implementation:

- Android RevenueCat selection returned `fake`, missing-key production did not throw, and web commerce reported iOS.
- Android AdMob config reader was absent; configured Android selected `disabled`.
- Android AdMob was excluded from Capacitor `includePlugins`.
- Google Play release module was absent; identity/provider/Firebase tests could not import it.
- Android AppsFlyer config explicitly returned `iOS bridge unavailable`.
- AdMob-selected release validation accepted overlays with no Android manifest wiring.
- Crashlytics did not include from the protected Android Firebase materialization seam.
- Production provider/version/signer gates did not exist.
- The Google Play CLI doubled `games/<game>` when npm launched it from a workspace CWD.
- `android:validate` could pass from committed overlay filenames without any generated Android project.
- Crashlytics selection copied Firebase configuration but did not apply its required Gradle classpath/plugin.
- AppsFlyer selection, Android test-ad settings, and test/dev leakage were not fully gated.

## Sparse-worktree blockers observed

Both Android build attempts passed the new Android environment validation and completed Vite transformation, then stopped because the sparse worktree omits the production level bundle:

```text
ENOENT: games/find_the_dog/public/levels/bundled-manifest.json
ENOENT: games/find_the_bird/public/levels/bundled-manifest.json
```

The unfiltered Find the Bird unit run also has exactly three sparse-content failures: `five-square-campaign.test.ts` cannot open `public/levels/levels-index.json`, and two restoration cleanup tests cannot scan `public/levels`. These are content-absence failures, not changed provider/release behavior.

A final unconfigured rerun on 2026-09-02 stopped earlier, as intended, at the absent owner value `VITE_FIREBASE_PROJECT_ID` in each ignored `.env.android.local`. No substitute project ID was invented. The earlier sparse-content result used explicit synthetic validator fixtures and remains diagnostic only.

## Exact release commands

Set protected values in the operator environment; do not commit them:

```sh
export PLAY_VERSION_CODE='<monotonically increasing integer>'
export PLAY_VERSION_NAME='<x.y.z>'
export VITE_REVENUECAT_ANDROID_API_KEY='<RevenueCat goog_ public SDK key>'
export VITE_APPSFLYER_ENABLED=true
export VITE_APPSFLYER_DEV_KEY='<AppsFlyer dev key>'
export VITE_ATTRIBUTION_PROVIDER=appsflyer
export VITE_ADMOB_ANDROID_ENABLED=true
export VITE_ADMOB_ANDROID_APP_ID='<AdMob Android app id>'
export VITE_ADMOB_ANDROID_BANNER_ID='<AdMob Android banner unit id>'
export VITE_ADMOB_ANDROID_INTERSTITIAL_ID='<AdMob Android interstitial unit id>'
export VITE_ADMOB_ANDROID_REWARDED_ID='<AdMob Android rewarded unit id>'
export PLAY_UPLOAD_KEYSTORE_PATH='<absolute protected keystore path>'
export PLAY_UPLOAD_KEY_ALIAS='<upload alias>'
export PLAY_UPLOAD_KEY_PASSWORD='<protected password>'
export PLAY_UPLOAD_STORE_PASSWORD='<protected password>'
export PLAY_UPLOAD_CERT_SHA256='<expected upload certificate SHA-256>'
export BUNDLETOOL_JAR='<absolute bundletool jar path>'
```

When an exact package-matched Firebase Android config exists:

```sh
export VITE_FIREBASE_CRASHLYTICS_ENABLED=true
export FIREBASE_ANDROID_CONFIG_PATH='<absolute protected google-services.json path>'
```

Otherwise keep Crashlytics explicitly off for the candidate:

```sh
export VITE_FIREBASE_CRASHLYTICS_ENABLED=false
unset FIREBASE_ANDROID_CONFIG_PATH
```

After restoring the sparse production content, run one game at a time:

```sh
npm run android:validate-source -w @fabrikav2/find_the_dog
npm run android:add -w @fabrikav2/find_the_dog
npm run android:validate -w @fabrikav2/find_the_dog
npm run android:release -w @fabrikav2/find_the_dog

npm run android:validate-source -w @fabrikav2/find_the_bird
npm run android:add -w @fabrikav2/find_the_bird
npm run android:validate -w @fabrikav2/find_the_bird
npm run android:release -w @fabrikav2/find_the_bird
```

For an existing generated project use `android:sync` instead of `android:add`. Never set `FTB_DEV_SHELL_URL` for the Find the Bird release lane; validation rejects it.

## Remaining external and device blockers

- Restore the omitted `public/levels` production content in an isolated full checkout, then run the two builds and full unfiltered test suites.
- Obtain the real Android RevenueCat public keys, Base Game Lab AdMob Android app/unit IDs, AppsFlyer dev key, upload keystores/certificate fingerprints, and bundletool path through protected local seams.
- Materialize exact-package Android Firebase configs before enabling Crashlytics. No Firebase config was available or fabricated here.
- Generate and inspect the exact signed AABs. The inspection hooks exist but did not run because no AAB/signing material was available.
- Install each exact inspected artifact on a physical Android device and verify launch, package/version identity, purchases/restores, ads/reward completion, AppsFlyer handoff, Crashlytics delivery, icons, and gameplay. None of those behaviors is claimed by source tests.
- Create/configure Play closed-test app records, upload AABs, complete Play declarations, invite testers, and verify live closed-test availability. All store/account actions remain unauthorized and untouched.

## Commits

- `a88e6862e` `fix(commerce): fail closed on Android providers`
- `0b8a91d3b` `fix(ads): select AdMob on Android`
- `078920df5` `feat(android): add closed-test release lanes`
- `0bb6d409d` `fix(android): close release validation gaps`

## Known source residual

The shared SDK exports `isRevenueCatAndroidPublicKey`, while both game contexts currently retain the same small local validator. This avoids false local failures caused by this sparse worktree's `node_modules` symlink resolving workspace packages from the sibling `find-games-us-pilot` worktree. Consolidate onto the shared export after installing workspace dependencies inside a full isolated checkout; behavior is covered in both locations today.
