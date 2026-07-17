import fs from 'node:fs';
import path from 'node:path';

const EXPECTED_SKAD_COUNT = 152;
const GAME_NAME = /^[a-z0-9_]+$/;
const SKAD_ID = /^[a-z0-9]{10}\.skadnetwork$/;
const FIREBASE_PLIST = 'GoogleService-Info.plist';

const nativeFileIds = {
  'AppLovinMaxPlugin.swift': {
    buildId: 'A11F00012FAD000000000001',
    refId: 'A11F00032FAD000000000003',
  },
  'FindTheDogBridgeViewController.swift': {
    buildId: 'A11F00022FAD000000000002',
    refId: 'A11F00042FAD000000000004',
  },
  'AdjustAttributionPlugin.swift': {
    buildId: 'A11F00052FAD000000000005',
    refId: 'A11F00062FAD000000000006',
  },
};

const privacyFileIds = {
  buildId: 'A11F00072FAD000000000007',
  refId: 'A11F00082FAD000000000008',
  fileType: 'text.xml',
};

const googleServiceFile = {
  name: FIREBASE_PLIST,
  buildId: 'A11F00092FAD000000000009',
  refId: 'A11F00102FAD000000000010',
  fileType: 'text.plist.xml',
};

const frameworks = [
  ['AdServices.framework', 'A11F00112FAD000000000011', 'A11F00132FAD000000000013'],
  ['StoreKit.framework', 'A11F00122FAD000000000012', 'A11F00142FAD000000000014'],
  ['AdSupport.framework', 'A11F00152FAD000000000015', 'A11F00172FAD000000000017'],
  ['AppTrackingTransparency.framework', 'A11F00162FAD000000000016', 'A11F00182FAD000000000018'],
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeIfChanged(file, current, content, changed, relative) {
  if (current === content) return;
  fs.writeFileSync(file, content);
  changed.push(relative);
}

function nativeFilesFor(manifest) {
  return manifest.ios.swiftSources.map((name) => ({ name, ...nativeFileIds[name] }));
}

function privacyFileFor(manifest) {
  return { name: manifest.ios.privacyManifest, ...privacyFileIds };
}

function requireFile(file, label = file) {
  if (!fs.existsSync(file)) throw new Error(`missing ${label}: ${file}`);
}

function replaceRequired(content, pattern, replacement, label) {
  if (!pattern.test(content)) throw new Error(`cannot patch ${label}: expected generated-project anchor is missing`);
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
}

function insertBefore(content, marker, line, label) {
  if (content.includes(line)) return content;
  const index = content.indexOf(marker);
  if (index < 0) throw new Error(`cannot wire ${label}: missing ${marker}`);
  return `${content.slice(0, index)}${line}\n${content.slice(index)}`;
}

function insertAfter(content, pattern, line, label) {
  if (content.includes(line)) return content;
  if (!pattern.test(content)) throw new Error(`cannot wire ${label}: generated-project anchor is missing`);
  pattern.lastIndex = 0;
  return content.replace(pattern, `$&\n${line}`);
}

function insertIntoPhase(content, sectionName, line, label) {
  if (content.includes(line)) return content;
  const section = new RegExp(`(/\\* Begin ${sectionName} section \\*/[\\s\\S]*?files = \\(\\n)`);
  if (!section.test(content)) throw new Error(`cannot wire ${label}: ${sectionName} files phase is missing`);
  return content.replace(section, `$1${line}\n`);
}

function sourceWiringState(content, name) {
  const pieces = [
    new RegExp(`\\/\\* ${escapeRegExp(name)} in Sources \\*\\/ = \\{isa = PBXBuildFile;`),
    new RegExp(`\\/\\* ${escapeRegExp(name)} \\*\\/ = \\{isa = PBXFileReference;`),
    new RegExp(`\\/\\* ${escapeRegExp(name)} \\*\\/,`),
    new RegExp(`\\/\\* ${escapeRegExp(name)} in Sources \\*\\/,`),
  ];
  return stateFromPieces(content, pieces);
}

function resourceWiringState(content, name) {
  const pieces = [
    new RegExp(`\\/\\* ${escapeRegExp(name)} in Resources \\*\\/ = \\{isa = PBXBuildFile;`),
    new RegExp(`\\/\\* ${escapeRegExp(name)} \\*\\/ = \\{isa = PBXFileReference;`),
    new RegExp(`\\/\\* ${escapeRegExp(name)} \\*\\/,`),
    new RegExp(`\\/\\* ${escapeRegExp(name)} in Resources \\*\\/,`),
  ];
  return stateFromPieces(content, pieces);
}

function frameworkWiringState(content, name) {
  const pieces = [
    new RegExp(`\\/\\* ${escapeRegExp(name)} in Frameworks \\*\\/ = \\{isa = PBXBuildFile;`),
    new RegExp(`\\/\\* ${escapeRegExp(name)} \\*\\/ = \\{isa = PBXFileReference;`),
    new RegExp(`\\/\\* ${escapeRegExp(name)} in Frameworks \\*\\/,`),
  ];
  return stateFromPieces(content, pieces);
}

function stateFromPieces(content, pieces) {
  const count = pieces.filter((pattern) => pattern.test(content)).length;
  if (count === 0) return 'absent';
  if (count === pieces.length) return 'wired';
  return 'partial';
}

function assertWiringState(state, name) {
  if (state === 'partial') throw new Error(`partial ${name} project wiring; regenerate or remove the stray entries before applying`);
}

function wireSource(content, file) {
  const state = sourceWiringState(content, file.name);
  assertWiringState(state, file.name);
  if (state === 'wired') return content;
  let next = content;
  next = insertBefore(
    next,
    '/* End PBXBuildFile section */',
    `\t\t${file.buildId} /* ${file.name} in Sources */ = {isa = PBXBuildFile; fileRef = ${file.refId} /* ${file.name} */; };`,
    file.name,
  );
  next = insertBefore(
    next,
    '/* End PBXFileReference section */',
    `\t\t${file.refId} /* ${file.name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${file.name}; sourceTree = "<group>"; };`,
    file.name,
  );
  next = insertAfter(
    next,
    /^\s*[0-9A-F]{24} \/\* AppDelegate\.swift \*\/,\s*$/m,
    `\t\t\t\t${file.refId} /* ${file.name} */,`,
    file.name,
  );
  next = insertAfter(
    next,
    /^\s*[0-9A-F]{24} \/\* AppDelegate\.swift in Sources \*\/,\s*$/m,
    `\t\t\t\t${file.buildId} /* ${file.name} in Sources */,`,
    file.name,
  );
  return next;
}

function wireResource(content, file) {
  const state = resourceWiringState(content, file.name);
  assertWiringState(state, file.name);
  if (state === 'wired') return content;
  let next = content;
  next = insertBefore(
    next,
    '/* End PBXBuildFile section */',
    `\t\t${file.buildId} /* ${file.name} in Resources */ = {isa = PBXBuildFile; fileRef = ${file.refId} /* ${file.name} */; };`,
    file.name,
  );
  next = insertBefore(
    next,
    '/* End PBXFileReference section */',
    `\t\t${file.refId} /* ${file.name} */ = {isa = PBXFileReference; lastKnownFileType = ${file.fileType}; path = ${file.name}; sourceTree = "<group>"; };`,
    file.name,
  );
  next = insertAfter(
    next,
    /^\s*[0-9A-F]{24} \/\* AppDelegate\.swift \*\/,\s*$/m,
    `\t\t\t\t${file.refId} /* ${file.name} */,`,
    file.name,
  );
  next = insertIntoPhase(
    next,
    'PBXResourcesBuildPhase',
    `\t\t\t\t${file.buildId} /* ${file.name} in Resources */,`,
    file.name,
  );
  return next;
}

function wireFramework(content, [name, buildId, refId]) {
  const state = frameworkWiringState(content, name);
  assertWiringState(state, name);
  if (state === 'wired') return content;
  let next = content;
  next = insertBefore(
    next,
    '/* End PBXBuildFile section */',
    `\t\t${buildId} /* ${name} in Frameworks */ = {isa = PBXBuildFile; fileRef = ${refId} /* ${name} */; settings = {ATTRIBUTES = (Weak, ); }; };`,
    name,
  );
  next = insertBefore(
    next,
    '/* End PBXFileReference section */',
    `\t\t${refId} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = ${name}; path = System/Library/Frameworks/${name}; sourceTree = SDKROOT; };`,
    name,
  );
  next = insertAfter(
    next,
    /^\s*[0-9A-F]{24} \/\* CapApp-SPM in Frameworks \*\/,\s*$/m,
    `\t\t\t\t${buildId} /* ${name} in Frameworks */,`,
    name,
  );
  return next;
}

function ensureBuildSettings(content, manifest) {
  let next = content.replace(/DEVELOPMENT_TEAM = [^;]+;\n/g, '');
  next = replaceRequired(
    next,
    /PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g,
    `PRODUCT_BUNDLE_IDENTIFIER = ${manifest.ios.bundleId};`,
    'iOS bundle identity',
  );
  next = replaceRequired(
    next,
    /TARGETED_DEVICE_FAMILY = (?:(?:"[^"]+")|[^;]+);/g,
    `TARGETED_DEVICE_FAMILY = ${manifest.ios.targetedDeviceFamily};`,
    'phone-only device family',
  );
  next = replaceRequired(
    next,
    /IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g,
    `IPHONEOS_DEPLOYMENT_TARGET = ${manifest.ios.deploymentTarget}.0;`,
    'iOS deployment target',
  );
  return next.replace(/buildSettings = \{[\s\S]*?\n\s*\};/g, (block) => {
    if (!block.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${manifest.ios.bundleId};`)) return block;
    let patched = block;
    const marker = `PRODUCT_BUNDLE_IDENTIFIER = ${manifest.ios.bundleId};`;
    const indent = /\n(\s*)PRODUCT_BUNDLE_IDENTIFIER/.exec(patched)?.[1] ?? '\t\t\t\t';
    if (!patched.includes('ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES')) {
      patched = patched.replace(marker, `ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = YES;\n${indent}${marker}`);
    }
    if (!patched.includes('OTHER_LDFLAGS')) {
      patched = patched.replace(marker, `OTHER_LDFLAGS = "$(inherited) -ObjC";\n${indent}${marker}`);
    }
    return patched;
  });
}

export function patchPbxproj(content, manifest, { googleServicePresent = false } = {}) {
  let next = content;
  for (const file of nativeFilesFor(manifest)) next = wireSource(next, file);
  next = wireResource(next, privacyFileFor(manifest));
  for (const framework of frameworks) next = wireFramework(next, framework);
  if (googleServicePresent) next = wireResource(next, googleServiceFile);
  const googleState = resourceWiringState(next, FIREBASE_PLIST);
  assertWiringState(googleState, FIREBASE_PLIST);
  if (!googleServicePresent && googleState === 'wired') {
    throw new Error(`${FIREBASE_PLIST} is wired but missing on disk; restore it or regenerate the project`);
  }
  return ensureBuildSettings(next, manifest);
}

export function patchStoryboard(content) {
  const desired = '<viewController id="BYZ-38-t0r" customClass="FindTheDogBridgeViewController" customModule="App" customModuleProvider="target" sceneMemberID="viewController"/>';
  if (content.includes(desired)) return content;
  const candidate = /<viewController id="BYZ-38-t0r"[^>]*sceneMemberID="viewController"\s*\/>/;
  return replaceRequired(content, candidate, desired, 'FindTheDog bridge storyboard class');
}

function replacePlistEntry(content, key, valueXml) {
  const pattern = new RegExp(`<key>${escapeRegExp(key)}<\\/key>\\s*(?:<string>[\\s\\S]*?<\\/string>|<(?:true|false)\\/>|<array>[\\s\\S]*?<\\/array>)`);
  const entry = `<key>${key}</key>\n\t${valueXml}`;
  if (pattern.test(content)) return content.replace(pattern, entry);
  const closing = content.lastIndexOf('</dict>');
  if (closing < 0) throw new Error(`Info.plist has no top-level </dict> for ${key}`);
  return `${content.slice(0, closing)}\t${entry}\n${content.slice(closing)}`;
}

export function patchInfoPlist(content, manifest, skAdIds) {
  if (skAdIds.length !== EXPECTED_SKAD_COUNT || new Set(skAdIds).size !== EXPECTED_SKAD_COUNT) {
    throw new Error(`SKAdNetwork catalog must contain exactly ${EXPECTED_SKAD_COUNT} unique identifiers`);
  }
  let next = content;
  next = replacePlistEntry(next, 'CFBundleDisplayName', `<string>${manifest.ios.displayName}</string>`);
  next = replacePlistEntry(next, 'NSUserTrackingUsageDescription', `<string>${manifest.ios.trackingUsageDescription}</string>`);
  next = replacePlistEntry(next, 'ITSAppUsesNonExemptEncryption', '<false/>');
  next = replacePlistEntry(next, 'GOOGLE_ANALYTICS_IDFV_COLLECTION_ENABLED', '<false/>');
  const portrait = '<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>';
  next = replacePlistEntry(next, 'UISupportedInterfaceOrientations', portrait);
  next = replacePlistEntry(next, 'UISupportedInterfaceOrientations~ipad', portrait);
  const items = [...skAdIds]
    .sort()
    .map((id) => `\t\t<dict>\n\t\t\t<key>SKAdNetworkIdentifier</key>\n\t\t\t<string>${id}</string>\n\t\t</dict>`)
    .join('\n');
  next = replacePlistEntry(next, 'SKAdNetworkItems', `<array>\n${items}\n\t</array>`);
  return next;
}

export function renderPackageSwift(manifest) {
  const dependencies = [
    ...manifest.ios.remotePackages.map((pkg) =>
      // Swift 6.1 SPM: the name: label is only valid with from:/branch:/revision:
      // requirements (v1-proven: AppLovin/Adjust/UMP need it so .product(package:)
      // refs resolve); the exact: overload has no name variant (capacitor pin).
      pkg.requirement === 'exact'
        ? `        .package(url: "${pkg.url}", exact: "${pkg.version}")`
        : `        .package(name: "${pkg.name}", url: "${pkg.url}", ${pkg.requirement}: "${pkg.version}")`),
    ...manifest.ios.localPackages.map((pkg) => {
      const traits = pkg.traits?.length ? `, traits: [${pkg.traits.map((trait) => `"${trait}"`).join(', ')}]` : '';
      return `        .package(name: "${pkg.name}", path: "${pkg.path}"${traits})`;
    }),
  ];
  const products = [
    ...manifest.ios.remotePackages.flatMap((pkg) => pkg.products.map((product) => ({ product, package: pkg.name }))),
    ...manifest.ios.localPackages.map((pkg) => ({ product: pkg.product, package: pkg.name })),
  ];
  return `// swift-tools-version: ${manifest.ios.swiftToolsVersion}
import PackageDescription

// Generated deterministically by tools/native-shell from shell-manifest.json.
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v${manifest.ios.deploymentTarget})],
    products: [
        .library(name: "CapApp-SPM", targets: ["CapApp-SPM"])
    ],
    dependencies: [
${dependencies.join(',\n')}
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
${products.map(({ product, package: packageName }) => `                .product(name: "${product}", package: "${packageName}")`).join(',\n')}
            ]
        )
    ]
)
`;
}

function loadContext(repoRoot, game) {
  if (!GAME_NAME.test(game)) throw new Error(`invalid game name: ${game}`);
  const gameDir = path.join(repoRoot, 'games', game);
  const recipeDir = path.join(gameDir, 'native-resources', 'ios');
  const manifestPath = path.join(recipeDir, 'shell-manifest.json');
  requireFile(manifestPath, 'shell manifest');
  const manifest = readJson(manifestPath);
  if (manifest.schemaVersion !== 1 || manifest.game !== game) throw new Error('shell manifest schema/game mismatch');
  const catalogPath = path.join(recipeDir, manifest.ios.skAdNetworkCatalog);
  requireFile(catalogPath, 'SKAdNetwork catalog');
  const ids = readJson(catalogPath).skadnetwork_ids?.map((entry) => entry.skadnetwork_id) ?? [];
  return { gameDir, recipeDir, manifest, ids };
}

function validateCatalog(ids, issues) {
  if (ids.length !== EXPECTED_SKAD_COUNT) issues.push(`SKAdNetwork catalog has ${ids.length} entries, expected ${EXPECTED_SKAD_COUNT}`);
  if (new Set(ids).size !== ids.length) issues.push('SKAdNetwork catalog contains duplicates');
  const malformed = ids.filter((id) => !SKAD_ID.test(id));
  if (malformed.length) issues.push(`SKAdNetwork catalog contains malformed identifiers: ${malformed.join(', ')}`);
}

function validateManifest(manifest, issues) {
  const requiredStrings = [
    ['capacitorAppId', manifest.capacitorAppId],
    ['ios.bundleId', manifest.ios?.bundleId],
    ['ios.displayName', manifest.ios?.displayName],
    ['ios.swiftToolsVersion', manifest.ios?.swiftToolsVersion],
    ['ios.deploymentTarget', manifest.ios?.deploymentTarget],
    ['ios.trackingUsageDescription', manifest.ios?.trackingUsageDescription],
  ];
  for (const [name, value] of requiredStrings) if (typeof value !== 'string' || !value.trim()) issues.push(`shell manifest ${name} must be a non-empty string`);
  const localPackages = manifest.ios?.localPackages ?? [];
  const remotePackages = manifest.ios?.remotePackages ?? [];
  const names = [...localPackages, ...remotePackages].map((pkg) => pkg.name);
  if (new Set(names).size !== names.length) issues.push('shell manifest package names must be unique');
  const products = [
    ...localPackages.map((pkg) => pkg.product),
    ...remotePackages.flatMap((pkg) => pkg.products ?? []),
  ];
  if (new Set(products).size !== products.length) issues.push('shell manifest package products must be unique');
  for (const pkg of localPackages) {
    if (typeof pkg.path !== 'string' || !/^\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/node_modules\/[a-zA-Z0-9@._/-]+$/.test(pkg.path)) {
      issues.push(`shell manifest local package ${pkg.name ?? '(unnamed)'} has an unsafe/non-node_modules path`);
    }
  }
  for (const pkg of remotePackages) {
    if (!['exact', 'from'].includes(pkg.requirement)) issues.push(`shell manifest remote package ${pkg.name ?? '(unnamed)'} has unsupported requirement ${pkg.requirement}`);
    if (typeof pkg.url !== 'string' || !pkg.url.startsWith('https://')) issues.push(`shell manifest remote package ${pkg.name ?? '(unnamed)'} must use an https URL`);
    if (!/^\d+\.\d+\.\d+$/.test(pkg.version ?? '')) issues.push(`shell manifest remote package ${pkg.name ?? '(unnamed)'} has invalid semantic version`);
  }
  if (new Set(manifest.ios?.swiftSources ?? []).size !== (manifest.ios?.swiftSources ?? []).length) issues.push('shell manifest swiftSources must be unique');
  for (const source of manifest.ios?.swiftSources ?? []) if (!nativeFileIds[source]) issues.push(`shell manifest swift source has no stable PBX identity: ${source}`);
  if (manifest.ios?.privacyManifest !== 'PrivacyInfo.xcprivacy') issues.push('shell manifest privacyManifest must be PrivacyInfo.xcprivacy');
}

function validateRecipeSources(recipeDir, manifest, issues) {
  const appDir = path.join(recipeDir, 'App');
  for (const file of ['AppDelegate.swift', ...manifest.ios.swiftSources, manifest.ios.privacyManifest]) {
    if (!fs.existsSync(path.join(appDir, file))) issues.push(`native recipe is missing App/${file}`);
  }
  const read = (file) => fs.existsSync(path.join(appDir, file)) ? fs.readFileSync(path.join(appDir, file), 'utf8') : '';
  const appDelegate = read('AppDelegate.swift');
  for (const snippet of ['setCategory(.playback', '.mixWithOthers']) if (!appDelegate.includes(snippet)) issues.push(`AppDelegate.swift is missing ${snippet}`);
  const bridge = read('FindTheDogBridgeViewController.swift');
  for (const snippet of ['registerPluginInstance(AppLovinMaxPlugin())', 'registerPluginInstance(AdjustAttributionPlugin())', 'contentInsetAdjustmentBehavior = .never']) {
    if (!bridge.includes(snippet)) issues.push(`FindTheDogBridgeViewController.swift is missing ${snippet}`);
  }
  const appLovin = read('AppLovinMaxPlugin.swift');
  for (const method of ['initialize', 'showBanner', 'hideBanner', 'preloadInterstitial', 'showInterstitial', 'preloadRewarded', 'showRewarded', 'showPrivacyOptions']) {
    if (!appLovin.includes(`CAPPluginMethod(name: "${method}"`)) issues.push(`AppLovinMaxPlugin.swift is missing ${method}`);
  }
  for (const snippet of [
    'bannerDisplayable',
    'bannerRequestedVisible',
    'notifyListeners("adRevenuePaid"',
    'let consentFlow = call.getObject("consentFlow") ?? [:]',
    'settings.privacyPolicyURL = privacyPolicyURL',
    'settings.termsOfServiceURL = termsOfServiceURL',
    'ALSdk.shared().cmpService.showCMPForExistingUser {',
  ]) if (!appLovin.includes(snippet)) issues.push(`AppLovinMaxPlugin.swift is missing ${snippet}`);
  if ((appLovin.match(/MAAdView\(adUnitIdentifier:/g) ?? []).length !== 1) issues.push('AppLovinMaxPlugin.swift must create exactly one MAAdView');
  if ((appLovin.match(/adView\.loadAd\(\)/g) ?? []).length !== 1) issues.push('AppLovinMaxPlugin.swift must explicitly load the banner exactly once');
  for (const forbidden of ['destroyBanner', 'removeFromSuperview', 'bannerAdView = nil', 'showCMPForExistingUser(from:']) if (appLovin.includes(forbidden)) issues.push(`AppLovinMaxPlugin.swift contains forbidden persistent-banner/consent source: ${forbidden}`);
  const adjust = read('AdjustAttributionPlugin.swift');
  for (const snippet of [
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
  ]) if (!adjust.includes(snippet)) issues.push(`AdjustAttributionPlugin.swift is missing ${snippet}`);
  for (const forbidden of ['getBool("disableIdfaReading")', 'getBool("disableAppTrackingTransparencyUsage")', 'call.getString("eventToken")']) if (adjust.includes(forbidden)) issues.push(`AdjustAttributionPlugin.swift exposes unsafe bridge input: ${forbidden}`);
  const privacy = read(manifest.ios.privacyManifest);
  for (const snippet of ['<key>NSPrivacyTracking</key>', '<true/>', '<string>applovin.com</string>', '<string>adjust.com</string>', 'NSPrivacyCollectedDataTypeAdvertisingData']) if (!privacy.includes(snippet)) issues.push(`PrivacyInfo.xcprivacy is missing ${snippet}`);
  const joined = [appDelegate, bridge, appLovin, adjust, privacy].join('\n');
  const secretPatterns = [
    /VITE_ADJUST_IOS_APP_TOKEN\s*=\s*[a-z0-9]{12}/i,
    /VITE_ADJUST_EVENT_[A-Z_]+_TOKEN\s*=\s*[a-z0-9]{6,}/i,
    /Adjust\s+app\s+token\s*[:=]\s*[a-z0-9]{12}/i,
  ];
  for (const pattern of secretPatterns) if (pattern.test(joined)) issues.push(`native recipe contains disallowed SDK token material: ${pattern.source}`);
}

function validatePackage(content, manifest, issues) {
  const expected = renderPackageSwift(manifest);
  if (content !== expected) issues.push('CapApp-SPM/Package.swift does not match the exact shell manifest graph');
  for (const legacy of ['Admob', 'CapacitorFilesystem', 'CapacitorPreferences', 'CapacitorShare']) if (content.includes(legacy)) issues.push(`Package.swift contains legacy product ${legacy}`);
}

function validateFirebaseIdentity(gameDir, manifest, { allowMissingFirebase }, issues) {
  const iosPlist = path.join(gameDir, 'ios', 'App', 'App', FIREBASE_PLIST);
  if (!fs.existsSync(iosPlist)) {
    if (!allowMissingFirebase) issues.push(`${FIREBASE_PLIST} is missing (pass --allow-missing to permit the gitignored owner file)`);
  } else {
    const content = fs.readFileSync(iosPlist, 'utf8');
    const bundle = /<key>BUNDLE_ID<\/key>\s*<string>([^<]+)<\/string>/.exec(content)?.[1];
    if (bundle !== manifest.ios.bundleId) issues.push(`${FIREBASE_PLIST} BUNDLE_ID is ${bundle ?? '(missing)'}, expected ${manifest.ios.bundleId}`);
  }
  const androidJson = path.join(gameDir, 'android', 'app', 'google-services.json');
  if (fs.existsSync(androidJson)) {
    const json = readJson(androidJson);
    const packages = json.client?.map((client) => client.client_info?.android_client_info?.package_name).filter(Boolean) ?? [];
    if (!packages.includes(manifest.capacitorAppId)) issues.push(`google-services.json does not contain Android package ${manifest.capacitorAppId}`);
  }
}

export function validateGeneratedShell({ repoRoot, game, allowMissingFirebase = true }) {
  const { gameDir, recipeDir, manifest, ids } = loadContext(repoRoot, game);
  const issues = collectRecipeIssues(gameDir, recipeDir, manifest, ids);
  const iosRoot = path.join(gameDir, 'ios', 'App');
  validateFirebaseIdentity(gameDir, manifest, { allowMissingFirebase }, issues);
  if (!fs.existsSync(iosRoot)) return { issues, generatedPresent: false, skAdNetworkCount: ids.length };
  const required = {
    plist: path.join(iosRoot, 'App', 'Info.plist'),
    project: path.join(iosRoot, 'App.xcodeproj', 'project.pbxproj'),
    packageSwift: path.join(iosRoot, 'CapApp-SPM', 'Package.swift'),
    storyboard: path.join(iosRoot, 'App', 'Base.lproj', 'Main.storyboard'),
  };
  for (const [label, file] of Object.entries(required)) if (!fs.existsSync(file)) issues.push(`generated iOS project is missing ${label}: ${file}`);
  if (issues.some((issue) => issue.startsWith('generated iOS project is missing'))) return { issues, generatedPresent: true, skAdNetworkCount: ids.length };
  const plist = fs.readFileSync(required.plist, 'utf8');
  const plistIds = [...plist.matchAll(/<key>SKAdNetworkIdentifier<\/key>\s*<string>([^<]+)<\/string>/g)].map((match) => match[1]);
  if (plistIds.length !== EXPECTED_SKAD_COUNT || new Set(plistIds).size !== EXPECTED_SKAD_COUNT || [...plistIds].sort().join('\n') !== [...ids].sort().join('\n')) issues.push('Info.plist SKAdNetworkItems must equal the 152-entry catalog exactly');
  for (const snippet of ['<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>', '<key>GOOGLE_ANALYTICS_IDFV_COLLECTION_ENABLED</key>\n\t<false/>', '<string>UIInterfaceOrientationPortrait</string>']) if (!plist.includes(snippet)) issues.push(`Info.plist is missing ${snippet}`);
  if (plist.includes('UIInterfaceOrientationLandscape')) issues.push('Info.plist contains a landscape orientation');
  const project = fs.readFileSync(required.project, 'utf8');
  for (const entry of fs.readdirSync(path.join(recipeDir, 'App'), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const generatedFile = path.join(iosRoot, 'App', entry.name);
    if (!fs.existsSync(generatedFile)) {
      issues.push(`generated iOS app is missing copied recipe file App/${entry.name}`);
    } else if (!fs.readFileSync(generatedFile).equals(fs.readFileSync(path.join(recipeDir, 'App', entry.name)))) {
      issues.push(`generated iOS app recipe file drifted: App/${entry.name}`);
    }
  }
  for (const file of nativeFilesFor(manifest)) if (sourceWiringState(project, file.name) !== 'wired') issues.push(`${file.name} is not fully wired into App Sources`);
  const privacyFile = privacyFileFor(manifest);
  if (resourceWiringState(project, privacyFile.name) !== 'wired') issues.push(`${privacyFile.name} is not fully wired into App Resources`);
  for (const [name] of frameworks) if (frameworkWiringState(project, name) !== 'wired') issues.push(`${name} is not fully weak-linked`);
  if (!project.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${manifest.ios.bundleId};`)) issues.push('project.pbxproj has the wrong iOS bundle identifier');
  if (!project.includes(`TARGETED_DEVICE_FAMILY = ${manifest.ios.targetedDeviceFamily};`)) issues.push('project.pbxproj is not phone-only');
  if (!project.includes(`IPHONEOS_DEPLOYMENT_TARGET = ${manifest.ios.deploymentTarget}.0;`)) issues.push('project.pbxproj has the wrong iOS deployment target');
  if (!project.includes('ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = YES;')) issues.push('project.pbxproj is missing Swift standard-library embedding');
  if (!project.includes('OTHER_LDFLAGS = "$(inherited) -ObjC";')) issues.push('project.pbxproj is missing inherited -ObjC linker flags');
  if (project.includes('DEVELOPMENT_TEAM =')) issues.push('project.pbxproj contains a hardcoded development team');
  const googleServicePresent = fs.existsSync(path.join(iosRoot, 'App', FIREBASE_PLIST));
  const googleState = resourceWiringState(project, FIREBASE_PLIST);
  if (googleState === 'partial') issues.push(`${FIREBASE_PLIST} has partial project wiring`);
  if (googleServicePresent && googleState !== 'wired') issues.push(`${FIREBASE_PLIST} is present but not wired into App Resources`);
  if (!googleServicePresent && googleState !== 'absent') issues.push(`${FIREBASE_PLIST} is absent but remains wired into App Resources`);
  const storyboard = fs.readFileSync(required.storyboard, 'utf8');
  if (!storyboard.includes('customClass="FindTheDogBridgeViewController" customModule="App"')) issues.push('storyboard bridge class is invalid');
  validatePackage(fs.readFileSync(required.packageSwift, 'utf8'), manifest, issues);
  return { issues, generatedPresent: true, skAdNetworkCount: ids.length };
}

function collectRecipeIssues(gameDir, recipeDir, manifest, ids) {
  const issues = [];
  validateManifest(manifest, issues);
  validateCatalog(ids, issues);
  validateRecipeSources(recipeDir, manifest, issues);
  if (manifest.capacitorAppId !== 'com.basegamelab.find_the_dog.dev') issues.push('Capacitor/Android identity drifted from com.basegamelab.find_the_dog.dev');
  const capacitorConfig = path.join(gameDir, 'capacitor.config.ts');
  if (!fs.existsSync(capacitorConfig) || !fs.readFileSync(capacitorConfig, 'utf8').includes(`appId: "${manifest.capacitorAppId}"`)) {
    issues.push(`capacitor.config.ts does not declare appId ${manifest.capacitorAppId}`);
  }
  return issues;
}

function copyRecipeApp(recipeDir, iosRoot, changed) {
  const sourceRoot = path.join(recipeDir, 'App');
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error(`native recipe App/ must contain files only: ${entry.name}`);
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(iosRoot, 'App', entry.name);
    const content = fs.readFileSync(source);
    const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
    if (current?.equals(content)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    changed.push(`App/${entry.name}`);
  }
}

export function applyNativeShell({ repoRoot, game }) {
  const { gameDir, recipeDir, manifest, ids } = loadContext(repoRoot, game);
  const recipeIssues = collectRecipeIssues(gameDir, recipeDir, manifest, ids);
  if (recipeIssues.length) throw new Error(`invalid native recipe:\n- ${recipeIssues.join('\n- ')}`);
  const iosRoot = path.join(gameDir, 'ios', 'App');
  requireFile(iosRoot, 'generated iOS App root (run cap sync ios first)');
  const files = {
    plist: path.join(iosRoot, 'App', 'Info.plist'),
    project: path.join(iosRoot, 'App.xcodeproj', 'project.pbxproj'),
    packageSwift: path.join(iosRoot, 'CapApp-SPM', 'Package.swift'),
    storyboard: path.join(iosRoot, 'App', 'Base.lproj', 'Main.storyboard'),
  };
  for (const [label, file] of Object.entries(files)) requireFile(file, label);
  const firebaseIssues = [];
  validateFirebaseIdentity(gameDir, manifest, { allowMissingFirebase: true }, firebaseIssues);
  if (firebaseIssues.length) throw new Error(`invalid native Firebase configuration:\n- ${firebaseIssues.join('\n- ')}`);
  const googleServicePresent = fs.existsSync(path.join(iosRoot, 'App', FIREBASE_PLIST));
  const originals = {
    plist: fs.readFileSync(files.plist, 'utf8'),
    storyboard: fs.readFileSync(files.storyboard, 'utf8'),
    project: fs.readFileSync(files.project, 'utf8'),
    packageSwift: fs.readFileSync(files.packageSwift, 'utf8'),
  };
  const outputs = {
    plist: patchInfoPlist(originals.plist, manifest, ids),
    storyboard: patchStoryboard(originals.storyboard),
    project: patchPbxproj(originals.project, manifest, { googleServicePresent }),
    packageSwift: renderPackageSwift(manifest),
  };
  const changed = [];
  copyRecipeApp(recipeDir, iosRoot, changed);
  writeIfChanged(files.plist, originals.plist, outputs.plist, changed, 'App/Info.plist');
  writeIfChanged(files.storyboard, originals.storyboard, outputs.storyboard, changed, 'App/Base.lproj/Main.storyboard');
  writeIfChanged(files.project, originals.project, outputs.project, changed, 'App.xcodeproj/project.pbxproj');
  writeIfChanged(files.packageSwift, originals.packageSwift, outputs.packageSwift, changed, 'CapApp-SPM/Package.swift');
  const result = validateGeneratedShell({ repoRoot, game, allowMissingFirebase: true });
  if (result.issues.length) throw new Error(`native shell validation failed after apply:\n- ${result.issues.join('\n- ')}`);
  return { changed, skAdNetworkCount: ids.length, googleServicePresent };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
