# Physical iOS checks

`HillFlowTests.swift` extends the existing repository `VerifyDeviceRunner`. It uses native XCUITest taps and drags against `com.basegamelab.hilltodieon`, plus the shared testkit accessibility marker. It does not substitute a browser renderer or force a victory state.

Run commands from `games/hill_to_die_on`. Supply the connected device UDID and your development team using `HILL_DEVICE` and `DEVELOPMENT_TEAM`. A generated Capacitor iOS shell and valid local signing identity are required.

```sh
VITE_ENABLE_TEST_HARNESS=true VITE_HILL_QA_PROFILE=false VITE_HILL_STRESS_COUNT=0 npm run build
npx cap sync ios
node --input-type=module -e 'import {applyNativeRecipe} from "../../tools/verify-device/src/steps.mjs"; applyNativeRecipe(process.cwd(),"ios")'
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination "id=$HILL_DEVICE" -derivedDataPath .work/ios-build -allowProvisioningUpdates "DEVELOPMENT_TEAM=$DEVELOPMENT_TEAM" build
xcrun devicectl device install app --device "$HILL_DEVICE" .work/ios-build/Build/Products/Debug-iphoneos/App.app
```

Prepare a generated adapter project, preserving the shared runner sources and spec:

```sh
node --input-type=module <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const runner=path.resolve('../../tools/verify-device/runner');
fs.mkdirSync('.work/device-runner',{recursive:true});
const spec=fs.readFileSync(runner+'/project.yml','utf8').replace('sources: [VerifyDeviceRunner]', `sources: [${runner}/VerifyDeviceRunner, ${path.resolve('tests/ios')}]`);
fs.writeFileSync('.work/device-runner/project.yml',spec);
fs.copyFileSync(runner+'/VerifyDeviceRunner.xctestplan','.work/device-runner/VerifyDeviceRunner.xctestplan');
JS
xcodegen generate --spec .work/device-runner/project.yml --project .work/device-runner
xcodebuild test -project .work/device-runner/VerifyDeviceRunner.xcodeproj -scheme VerifyDeviceRunner -destination "id=$HILL_DEVICE" -derivedDataPath .work/device-runner/build -resultBundlePath .work/touch.xcresult -allowProvisioningUpdates "DEVELOPMENT_TEAM=$DEVELOPMENT_TEAM" -only-testing:VerifyDeviceRunner/HillFlowTests/testRealTouchFlow
xcrun xcresulttool export attachments --path .work/touch.xcresult --output-path .work/touch-attachments
```

`testRealTouchFlow` checks firing before input, right/left thumb gestures, continued fire on release, pause, cards, wave transitions, and salvage after relaunch. It operates on the ordinary player save.

For `testMetaProgression`, rebuild with `VITE_HILL_QA_PROFILE=true` and zero stress count, then install. It spends a 1,000-salvage fixture in the separate `fabrikav2.hill-to-die-on.v1.device-qa` key, buys weapons/characters/permanent upgrades, places towers and walls, and verifies persistence. Run `testTenWaveLevel` afterward; it plays real-time waves with that upgraded loadout and verifies victory and starting level two. Test ordering is explicit: finish meta setup before the ten-wave test.

For `testCrowdPerformance`, rebuild with `VITE_HILL_STRESS_COUNT=8192`, the harness enabled, and QA profile disabled. It records 5-, 25-, and 45-second state/capture samples and a sequence of native screenshots. The stress fixture keeps its enemy count constant, recycles enemies at the perimeter, runs all four weapon behaviors, and cannot award salvage or record attempts. Performance percentiles come from native WKWebView RAF intervals; CPU measurements exclude GPU completion. Screenshot sequences demonstrate motion but are not high-frame-rate recordings.

After fixture tests, rebuild with QA profile false and stress zero, reinstall, and run the ordinary touch test. Preserve the exact build-info, asset hashes, native captures, and metric attachments together. Never leave the fixture build installed for the player.
