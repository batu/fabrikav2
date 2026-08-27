# Find games AdMob physical-device smoke

Date: 2026-08-27
Device: Batu’s physical iPhone 12 (`00008101-000410EC3EF9001E`)
Revision: `9572737bf`

## Safety controls

- Both builds used `VITE_ADMOB_IOS_TEST_MODE=true`.
- The native AdMob plugin replaces configured production unit IDs with Google's sample unit IDs whenever `isTesting` is true.
- No ad was clicked.
- Test-only environment values were ephemeral and were not committed.

## Results

- Find the Bird banner: **PASS**. The installed native app entered gameplay and visibly rendered Google's banner with both “Test mode” and “Test ad” labels. Evidence: `find-the-bird-test-banner.png`.
- Find the Dog banner: **PASS after fix**. The first smoke command incorrectly forced `VITE_CDN_ENABLED=false`, producing bright-green missing-asset geometry (`find-the-dog-device-failure.png`). After correcting that setup, native diagnostics exposed the actual ad defect: Capacitor selected the AdMob JS provider, but `capacitor.config.json` omitted `@capacitor-community/admob`, causing `"AdMob" plugin is not implemented on ios`. The sync-time allowlist read only shell env while runtime used committed public defaults. The allowlist now consumes the same committed defaults. A clean sync/build/install visibly rendered Google's “Test mode” / “Test ad” banner (`find-the-dog-test-banner.png`).
- Interstitial: **UNVERIFIED** for both games.
- Rewarded: **UNVERIFIED** for both games.

## Adjacent canonical-lane result

The repository `verify-device` lane built, installed, and launched Find the Bird with AdMob disabled, but the XCUITest tour failed after reaching menu/level because later accessibility state markers were not published. That exploratory run is not part of this AdMob pass.
