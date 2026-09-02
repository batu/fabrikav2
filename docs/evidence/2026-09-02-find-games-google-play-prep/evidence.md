---
status: partial
subject: Find games Google Play closed-test source preparation
created: 2026-09-02
mode: pipeline
---

# Evidence: Find games Google Play closed-test source preparation

## Verdict

Source provider selection and release gates are verified by tests, typecheck, and lint; exact Android builds, AAB inspection, physical-device behavior, and Play closed-test availability remain blocked by sparse content and protected external inputs.

## What Changed

- Android RevenueCat, AdMob, AppsFlyer, Firebase/Crashlytics, package, version, signing, icons, and exact-AAB seams were added for Find the Dog and Find the Bird.
- Production validators fail closed for absent/malformed selected providers, non-AppsFlyer attribution selection, Android test ads, test/verifier/tour/dev leakage, signing identity, and AAB identity.
- Source-recipe validation is separate from release validation. Release `android:validate` now requires a generated/applied Android project and inspects the generated AppsFlyer bridge/registration, AdMob manifest wiring, provider Gradle recipe, and enabled Crashlytics Gradle/Firebase configuration.
- iOS configuration paths were preserved while the Find the Dog Capacitor source identity was moved off its `.dev` value.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| test | `npm run test:unit -w @fabrikav2/find_the_dog` | passed, 283 tests |
| test | scoped Find the Bird unit run excluding sparse-content suites | passed, 345 tests |
| test | `npm run test:unit -w @fabrikav2/sdk` | passed, 337 tests |
| test | native-shell, game-env, and Google Play focused suites | passed, 12 + 39 + 23 tests |
| static | both game typechecks and linters | passed |
| build | both `build:android` attempts | Android env validation passed; Vite stopped at absent `public/levels/bundled-manifest.json` |
| review | correctness, security, testing, maintainability, project standards, adversarial | blocking source findings fixed; one documented consolidation residual remains |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| correctness/adversarial | partial | provider and release false-green gaps found and fixed; AAB/device proof unavailable |
| security/project standards | partial | signer, dev-shell, version, Firebase, and provider gates fixed; external credential identity unmaterialized |
| testing/maintainability | partial | Android AppsFlyer reachability and icon/native gaps fixed; shared RevenueCat validator consolidation deferred |

## Analysis

The tests directly exercise provider composition and deterministic release validators, including npm workspace-CWD subprocess coverage and generated-project fail-closed behavior. Source-recipe validation accepted complete synthetic, non-owner test values; `android:validate` correctly remains blocked because no generated project exists. Earlier build attempts reached missing sparse content after environment validation, before this stricter generated-project gate was added. This does not prove Gradle compilation, a signed AAB, native provider initialization, dashboard receipt, purchases, ads, Crashlytics delivery, device launch, or Play availability. The exact production inputs were intentionally not fabricated.

## Gaps

- `public/levels` production content is absent in this sparse worktree.
- No Android generated project was compiled and no AAB exists.
- No real provider IDs, Firebase config, signing key, expected certificate fingerprint, or bundletool path was available.
- No physical Android or Play Console verification was authorized or performed.
- Final unconfigured `build:android` reruns failed closed on absent `VITE_FIREBASE_PROJECT_ID` for both games. No owner value was fabricated; the earlier sparse-content build result used explicit synthetic validator fixtures and is diagnostic only.

## P1-P2 correction verification

- `npx vitest run --root tools/google-play test/release.test.mjs`: passed, 23 tests.
- `npx vitest run --root tools/game-env test/game-env.test.mjs`: passed, 39 tests.
- Both exact `android:validate-source` workspace scripts passed with obvious synthetic validator fixtures only; no protected credential was supplied, created, or persisted.
- Both exact `android:validate` workspace scripts failed closed because their generated Android projects are absent.
- `npx vitest run --root tools/refcap-compare test/manifest.test.mjs test/yaml.test.mjs`: passed, 7 tests. The full refcap suite remains infeasible in this sparse worktree because its committed Marble Run capture fixtures are omitted.
- No `games/find_the_bird/android` or `games/find_the_dog/android` tree was generated; the repository ignore recipe continues to cover `games/*/android/`.

## Next Action

Restore the omitted production content in a full isolated checkout, supply protected owner inputs, run each `android:release` lane, inspect the exact AAB, then install and verify that same artifact on a physical Android device before any Play upload.
