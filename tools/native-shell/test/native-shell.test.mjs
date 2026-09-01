import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyNativeShell,
  patchInfoPlist,
  patchPbxproj,
  patchStoryboard,
  renderPackageSwift,
  resolveRuntimeAdMobManifest,
  validateGeneratedShell,
} from '../src/native-shell.mjs';

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-shell-test-'));
  tempRoots.push(root);
  return root;
}

function plist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>App</string>
\t<key>UISupportedInterfaceOrientations</key>
\t<array><string>UIInterfaceOrientationLandscapeLeft</string></array>
\t<key>UISupportedInterfaceOrientations~ipad</key>
\t<array><string>UIInterfaceOrientationLandscapeLeft</string></array>
</dict>
</plist>
`;
}

function pbxproj({ partial = false } = {}) {
  return `// !$*UTF8*$!
/* Begin PBXBuildFile section */
\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 504EC3071FED79650016851F /* AppDelegate.swift */; };
${partial ? '\t\tA11F00012FAD000000000001 /* AppLovinMaxPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = A11F00032FAD000000000003 /* AppLovinMaxPlugin.swift */; };\n' : ''}/* End PBXBuildFile section */
/* Begin PBXFileReference section */
\t\t504EC3071FED79650016851F /* AppDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = AppDelegate.swift; sourceTree = "<group>"; };
/* End PBXFileReference section */
\t\tchildren = (
\t\t\t\t504EC3071FED79650016851F /* AppDelegate.swift */,
\t\t);
\t\tfiles = (
\t\t\t\t4D22ABE92AF431CB00220026 /* CapApp-SPM in Frameworks */,
\t\t);
\t\t\tbuildPhases = (
\t\t\t\t1234567890ABCDEF12345679 /* Sources */,
\t\t\t\t1234567890ABCDEF12345678 /* Resources */,
\t\t\t);
/* Begin PBXResourcesBuildPhase section */
\t\t1234567890ABCDEF12345678 /* Resources */ = {
\t\t\tisa = PBXResourcesBuildPhase;
\t\t\tfiles = (
\t\t\t);
\t\t};
/* End PBXResourcesBuildPhase section */
/* Begin PBXSourcesBuildPhase section */
\t\t1234567890ABCDEF12345679 /* Sources */ = {
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tfiles = (
\t\t\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */,
\t\t\t);
\t\t};
/* End PBXSourcesBuildPhase section */
\t\t\tbuildSettings = {
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.example.app;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 14.0;
\t\t\t};
`;
}

function storyboard() {
  return '<viewController id="BYZ-38-t0r" customClass="CAPBridgeViewController" customModule="Capacitor" sceneMemberID="viewController"/>';
}

function catalog(count = 152) {
  return Array.from({ length: count }, (_, index) => `${String(index).padStart(10, '0')}.skadnetwork`);
}

function manifest() {
  return {
    schemaVersion: 1,
    game: 'find_the_dog',
    capacitorAppId: 'com.basegamelab.find_the_dog.dev',
    ios: {
      bundleId: 'com.baseardahan.hiddenobj',
      firebaseProjectId: 'find-the-dog-basegamelab',
      displayName: 'Find the Dog',
      swiftToolsVersion: '6.1',
      deploymentTarget: '15',
      targetedDeviceFamily: '1',
      trackingUsageDescription: 'Tracking description',
      localPackages: [
        { name: 'CapacitorApp', path: '../../../../../node_modules/@capacitor/app', product: 'CapacitorApp' },
        { name: 'CapacitorFirebaseAnalytics', path: '../../../../../node_modules/@capacitor-firebase/analytics', product: 'CapacitorFirebaseAnalytics', traits: ['AnalyticsWithoutAdIdSupport'] },
      ],
      remotePackages: [
        { name: 'capacitor-swift-pm', url: 'https://github.com/ionic-team/capacitor-swift-pm.git', requirement: 'exact', version: '8.4.1', products: ['Capacitor', 'Cordova'] },
        { name: 'AppLovinSDK', url: 'https://example.invalid/applovin.git', requirement: 'from', version: '13.6.2', products: ['AppLovinSDK'] },
      ],
      swiftSources: ['AppLovinMaxPlugin.swift', 'FindTheDogBridgeViewController.swift', 'AdjustAttributionPlugin.swift'],
      privacyManifest: 'PrivacyInfo.xcprivacy',
      skAdNetworkCatalog: 'applovin-skadnetwork-ids.json',
    },
  };
}

describe('native shell transforms', () => {
  it('renders the exact package graph without legacy products', () => {
    const rendered = renderPackageSwift(manifest());
    expect(rendered).toContain('// swift-tools-version: 6.1');
    expect(rendered).toContain('platforms: [.iOS(.v15)]');
    expect(rendered).toContain('.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.4.1")');
    expect(rendered).toContain('.package(name: "AppLovinSDK", url: "https://example.invalid/applovin.git", from: "13.6.2")');
    // the exact: overload has no name label in Swift 6.1 — only exact-pinned
    // packages must drop it (from:-pinned keep name so product refs resolve)
    expect(rendered).not.toMatch(/\.package\(name: [^,]+, url: [^,]+, exact:/);
    expect(rendered).toContain('.package(name: "CapacitorApp", path: "../../../../../node_modules/@capacitor/app")');
    expect(rendered).toContain('traits: ["AnalyticsWithoutAdIdSupport"]');
    expect(rendered).not.toContain('Admob');
    expect(renderPackageSwift(manifest())).toBe(rendered);
  });

  it('replaces plist policy with exactly 152 catalog identifiers', () => {
    const once = patchInfoPlist(plist(), manifest(), catalog());
    const twice = patchInfoPlist(once, manifest(), catalog());
    expect(twice).toBe(once);
    expect((once.match(/SKAdNetworkIdentifier/g) ?? [])).toHaveLength(152);
    expect(once).toContain('<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>');
    expect(once).toContain('<key>GOOGLE_ANALYTICS_IDFV_COLLECTION_ENABLED</key>\n\t<false/>');
    expect(once).toContain('<string>UIInterfaceOrientationPortrait</string>');
    expect(once).not.toContain('Landscape');
  });

  it('omits native AdMob wiring when its explicit enable flag is off', () => {
    const configured = manifest();
    configured.ios.adMobEnabledEnv = 'VITE_ADMOB_IOS_ENABLED';
    configured.ios.adMobApplicationIdEnv = 'VITE_ADMOB_IOS_APP_ID';
    configured.ios.localPackages.push({
      name: 'CapacitorCommunityAdmob',
      path: '../../../../../node_modules/@capacitor-community/admob',
      product: 'CapacitorCommunityAdmob',
    });

    const disabled = resolveRuntimeAdMobManifest(configured, { VITE_ADMOB_IOS_ENABLED: 'false' });
    expect(disabled.ios.localPackages.map((pkg) => pkg.name)).not.toContain('CapacitorCommunityAdmob');
    expect(disabled.ios.adMobApplicationIdEnv).toBeNull();
    expect(disabled.ios.skAdNetworkCatalog).toBeNull();
    expect(resolveRuntimeAdMobManifest(configured, { VITE_ADMOB_IOS_ENABLED: 'true' })).toBe(configured);
  });

  it('uses committed AdMob enablement when no environment override exists', () => {
    const configured = manifest();
    configured.ios.adMobEnabledEnv = 'VITE_ADMOB_IOS_ENABLED';
    configured.ios.adMobApplicationIdEnv = 'VITE_ADMOB_IOS_APP_ID';
    configured.ios.localPackages.push({
      name: 'CapacitorCommunityAdmob',
      path: '../../../../../node_modules/@capacitor-community/admob',
      product: 'CapacitorCommunityAdmob',
    });

    expect(resolveRuntimeAdMobManifest(configured, {}, { enabled: true })).toBe(configured);
    expect(resolveRuntimeAdMobManifest(configured, {}, { enabled: false }).ios.adMobApplicationIdEnv).toBeNull();
    expect(resolveRuntimeAdMobManifest(configured, { VITE_ADMOB_IOS_ENABLED: 'false' }, { enabled: true }).ios.adMobApplicationIdEnv).toBeNull();
  });

  it('removes tracking and ad-network declarations for a provider-free shell', () => {
    const tracked = patchInfoPlist(plist(), manifest(), catalog());
    const providerFree = manifest();
    providerFree.ios.trackingUsageDescription = null;
    providerFree.ios.skAdNetworkCatalog = null;
    const clean = patchInfoPlist(tracked, providerFree, []);
    expect(clean).not.toContain('NSUserTrackingUsageDescription');
    expect(clean).not.toContain('SKAdNetworkItems');
    expect(clean).not.toContain('SKAdNetworkIdentifier');
  });

  it('patches project and storyboard idempotently and rejects partial wiring', () => {
    const once = patchPbxproj(pbxproj(), manifest(), { googleServicePresent: false });
    expect(patchPbxproj(once, manifest(), { googleServicePresent: false })).toBe(once);
    expect(once).toContain('AppLovinMaxPlugin.swift in Sources');
    expect(once).toContain('PrivacyInfo.xcprivacy in Resources');
    expect(once).toContain('PRODUCT_BUNDLE_IDENTIFIER = com.baseardahan.hiddenobj;');
    expect(once).not.toContain('GoogleService-Info.plist');
    expect(() => patchPbxproj(pbxproj({ partial: true }), manifest(), { googleServicePresent: false })).toThrow(/partial/i);

    const story = patchStoryboard(storyboard());
    expect(story).toContain('customClass="FindTheDogBridgeViewController"');
    expect(patchStoryboard(story)).toBe(story);
  });

  it('omits the Crashlytics dSYM upload phase unless the manifest opts in', () => {
    const off = patchPbxproj(pbxproj(), manifest(), { googleServicePresent: false });
    expect(off).not.toContain('Upload Crashlytics dSYMs');
    expect(off).not.toContain('PBXShellScriptBuildPhase');
  });

  it('wires the Crashlytics dSYM upload phase idempotently when opted in', () => {
    const withUpload = { ...manifest(), ios: { ...manifest().ios, crashlyticsSymbolUpload: true } };
    const once = patchPbxproj(pbxproj(), withUpload, { googleServicePresent: false });

    expect(once).toContain('/* Begin PBXShellScriptBuildPhase section */');
    expect(once).toContain('Upload Crashlytics dSYMs');
    // Runs after Resources, because the dSYM does not exist until linking ends.
    expect(once).toMatch(/\/\* Resources \*\/,\n\s*A11F00302FAD000000000030 \/\* Upload Crashlytics dSYMs \*\/,/);
    // Debug builds emit no dSYM; the phase must cost them nothing.
    expect(once).toContain('DEBUG_INFORMATION_FORMAT');
    // upload-symbols, not the firebase CLI, which is the Android/NDK path.
    expect(once).toContain('Crashlytics/upload-symbols');
    expect(patchPbxproj(once, withUpload, { googleServicePresent: false })).toBe(once);
  });

  it('escapes the upload script so the project file still parses', () => {
    // The script embeds double quotes. Unescaped, they terminate the pbxproj
    // string and Xcode refuses to open the project at all ("damaged ... parse
    // error"). Cost one failed archive to learn.
    const withUpload = { ...manifest(), ios: { ...manifest().ios, crashlyticsSymbolUpload: true } };
    const once = patchPbxproj(pbxproj(), withUpload, { googleServicePresent: false });
    const script = /shellScript = "((?:[^"\\]|\\.)*)";/.exec(once);

    expect(script).not.toBeNull();
    expect(script[1]).toContain('\\"$UPLOAD\\" -gsp \\"$GSP\\"');
    // Every quote inside the value must be backslash-escaped.
    expect(script[1].replace(/\\"/g, '')).not.toContain('"');
  });

  it('unwires the Crashlytics upload phase when the manifest opts back out', () => {
    const withUpload = { ...manifest(), ios: { ...manifest().ios, crashlyticsSymbolUpload: true } };
    const wired = patchPbxproj(pbxproj(), withUpload, { googleServicePresent: false });
    const unwired = patchPbxproj(wired, manifest(), { googleServicePresent: false });

    expect(unwired).not.toContain('A11F00302FAD000000000030');
    expect(unwired).not.toContain('Upload Crashlytics dSYMs');
  });
});

describe('native shell integration', () => {
  it('applies twice byte-identically and validates without node_modules packages', () => {
    const repoRoot = makeRoot();
    const gameDir = path.join(repoRoot, 'games', 'find_the_dog');
    const recipeDir = path.join(gameDir, 'native-resources', 'ios');
    const appRecipeDir = path.join(recipeDir, 'App');
    const iosAppDir = path.join(gameDir, 'ios', 'App');
    fs.mkdirSync(appRecipeDir, { recursive: true });
    fs.mkdirSync(path.join(iosAppDir, 'App', 'Base.lproj'), { recursive: true });
    fs.mkdirSync(path.join(iosAppDir, 'App.xcodeproj'), { recursive: true });
    fs.mkdirSync(path.join(iosAppDir, 'CapApp-SPM'), { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'capacitor.config.ts'), 'const config = { appId: "com.basegamelab.find_the_dog.dev" };\nexport default config;\n');
    fs.writeFileSync(path.join(recipeDir, 'shell-manifest.json'), `${JSON.stringify(manifest(), null, 2)}\n`);
    fs.writeFileSync(path.join(recipeDir, 'applovin-skadnetwork-ids.json'), `${JSON.stringify({ skadnetwork_ids: catalog().map((skadnetwork_id) => ({ skadnetwork_id })) })}\n`);
    fs.writeFileSync(path.join(appRecipeDir, 'AppDelegate.swift'), 'setCategory(.playback, options: [.mixWithOthers])\n');
    fs.writeFileSync(path.join(appRecipeDir, 'FindTheDogBridgeViewController.swift'), 'registerPluginInstance(AppLovinMaxPlugin())\nregisterPluginInstance(AdjustAttributionPlugin())\ncontentInsetAdjustmentBehavior = .never\n');
    fs.writeFileSync(path.join(appRecipeDir, 'AppLovinMaxPlugin.swift'), [
      'CAPPluginMethod(name: "initialize"',
      'CAPPluginMethod(name: "showBanner"',
      'CAPPluginMethod(name: "hideBanner"',
      'CAPPluginMethod(name: "preloadInterstitial"',
      'CAPPluginMethod(name: "showInterstitial"',
      'CAPPluginMethod(name: "preloadRewarded"',
      'CAPPluginMethod(name: "showRewarded"',
      'CAPPluginMethod(name: "showPrivacyOptions"',
      'bannerDisplayable bannerRequestedVisible notifyListeners("adRevenuePaid"',
      'let consentFlow = call.getObject("consentFlow") ?? [:]',
      'settings.privacyPolicyURL = privacyPolicyURL',
      'settings.termsOfServiceURL = termsOfServiceURL',
      'ALSdk.shared().cmpService.showCMPForExistingUser {',
      'MAAdView(adUnitIdentifier: id)',
      'adView.loadAd()',
    ].join('\n'));
    fs.writeFileSync(path.join(appRecipeDir, 'AdjustAttributionPlugin.swift'), [
      'config.isValid()',
      'disableIdfaReading()',
      'disableAppTrackingTransparencyUsage()',
      'allowedCallbackParametersByEvent',
      'eventTokens[eventName]',
      'allowedCallbackParameters.contains(key)',
      'event.addCallbackParameter(key, value: capped(stringValue))',
      '"appOpen": ["cohort_bucket"]',
      '"levelStart": ["level_id", "level_name"]',
      '"levelComplete": ["level_id", "time_seconds", "hints_used", "wrong_taps"]',
      '"levelFailed": ["level_id", "dogs_found"]',
      '"rewardedWatched": ["placement"]',
    ].join('\n'));
    fs.writeFileSync(path.join(appRecipeDir, 'PrivacyInfo.xcprivacy'), '<?xml version="1.0"?><plist><dict><key>NSPrivacyTracking</key><true/><string>applovin.com</string><string>adjust.com</string><string>NSPrivacyCollectedDataTypeAdvertisingData</string></dict></plist>');
    fs.writeFileSync(path.join(iosAppDir, 'App', 'Info.plist'), plist());
    fs.writeFileSync(path.join(iosAppDir, 'App', 'Base.lproj', 'Main.storyboard'), storyboard());
    fs.writeFileSync(path.join(iosAppDir, 'App.xcodeproj', 'project.pbxproj'), pbxproj());
    fs.writeFileSync(path.join(iosAppDir, 'CapApp-SPM', 'Package.swift'), '// generated\n');

    applyNativeShell({ repoRoot, game: 'find_the_dog' });
    const snapshot = new Map([
      ['plist', fs.readFileSync(path.join(iosAppDir, 'App', 'Info.plist'), 'utf8')],
      ['pbx', fs.readFileSync(path.join(iosAppDir, 'App.xcodeproj', 'project.pbxproj'), 'utf8')],
      ['package', fs.readFileSync(path.join(iosAppDir, 'CapApp-SPM', 'Package.swift'), 'utf8')],
    ]);
    const secondApply = applyNativeShell({ repoRoot, game: 'find_the_dog' });
    expect(fs.readFileSync(path.join(iosAppDir, 'App', 'Info.plist'), 'utf8')).toBe(snapshot.get('plist'));
    expect(fs.readFileSync(path.join(iosAppDir, 'App.xcodeproj', 'project.pbxproj'), 'utf8')).toBe(snapshot.get('pbx'));
    expect(fs.readFileSync(path.join(iosAppDir, 'CapApp-SPM', 'Package.swift'), 'utf8')).toBe(snapshot.get('package'));
    expect(secondApply.changed).toEqual([]);
    expect(validateGeneratedShell({ repoRoot, game: 'find_the_dog', allowMissingFirebase: true }).issues).toEqual([]);
    expect(validateGeneratedShell({ repoRoot, game: 'find_the_dog', allowMissingFirebase: false }).issues).toContainEqual(expect.stringMatching(/GoogleService-Info\.plist is missing/));

    fs.writeFileSync(path.join(iosAppDir, 'App', 'GoogleService-Info.plist'), '<plist><dict><key>BUNDLE_ID</key><string>com.baseardahan.hiddenobj</string><key>PROJECT_ID</key><string>find-the-dog-basegamelab</string><key>GOOGLE_APP_ID</key><string>1:123:ios:abcdef</string></dict></plist>');
    const firebaseApply = applyNativeShell({ repoRoot, game: 'find_the_dog' });
    expect(firebaseApply.changed).toContain('App.xcodeproj/project.pbxproj');
    expect(validateGeneratedShell({ repoRoot, game: 'find_the_dog', allowMissingFirebase: false }).issues).toEqual([]);
    expect(applyNativeShell({ repoRoot, game: 'find_the_dog' }).changed).toEqual([]);
  });
});

describe('Find the Dog manifest contract', () => {
  it('pins the approved identities, Crashlytics-only Firebase graph, AdMob, and catalog', () => {
    const recipeDir = new URL('../../../games/find_the_dog/native-resources/ios/', import.meta.url);
    const actualManifest = JSON.parse(fs.readFileSync(new URL('shell-manifest.json', recipeDir), 'utf8'));
    const actualCatalog = JSON.parse(fs.readFileSync(new URL('admob-skadnetwork-ids.json', recipeDir), 'utf8'));
    expect(actualManifest.capacitorAppId).toBe('com.basegamelab.findthedog');
    expect(actualManifest.ios.bundleId).toBe('com.baseardahan.hiddenobj');
    expect(actualManifest.ios.swiftToolsVersion).toBe('6.1');
    expect(actualManifest.ios.deploymentTarget).toBe('15');
    expect(Object.fromEntries(actualManifest.ios.remotePackages.map((pkg) => [pkg.name, pkg.version]))).toEqual({
      'capacitor-swift-pm': '8.4.1',
      'AppsFlyerFramework-Strict': '6.17.5',
    });
    expect(actualManifest.ios.localPackages.map((pkg) => pkg.name)).toEqual([
      'CapacitorApp',
      'CapacitorHaptics',
      'CapacitorLocalNotifications',
      'CapacitorFirebaseCrashlytics',
      'RevenuecatPurchasesCapacitor',
      'CapacitorCommunityAdmob',
    ]);
    expect(actualManifest.ios.localPackages.some((pkg) => pkg.name === 'CapacitorFirebaseAnalytics')).toBe(false);
    expect(actualManifest.ios.crashlyticsSymbolUpload).toBe(true);
    expect(actualManifest.ios.firebaseProjectId).toBe('find-the-dog-basegamelab');
    expect(actualManifest.ios.swiftSources).toContain('AppsFlyerAttributionPlugin.swift');
    expect(actualManifest.ios.swiftSources).not.toContain('AdjustAttributionPlugin.swift');
    expect(actualManifest.ios.remotePackages[1]).toMatchObject({
      url: 'https://github.com/AppsFlyerSDK/AppsFlyerFramework-Strict',
      products: ['AppsFlyerLib-Strict'],
    });
    expect(actualManifest.ios.adMobEnabledEnv).toBe('VITE_ADMOB_IOS_ENABLED');
    expect(actualManifest.ios.adMobApplicationIdEnv).toBe('VITE_ADMOB_IOS_APP_ID');
    expect(actualManifest.ios.trackingUsageDescription).toBeNull();
    const privacy = fs.readFileSync(new URL('App/PrivacyInfo.xcprivacy', recipeDir), 'utf8');
    expect(privacy).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(privacy).not.toContain('NSPrivacyTrackingDomains');
    expect(actualCatalog.skadnetwork_ids.map((entry) => entry.skadnetwork_id)).toEqual(['cstr6suwn9.skadnetwork']);
  });
});
