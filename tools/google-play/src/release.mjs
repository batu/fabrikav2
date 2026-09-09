import fs from 'node:fs';
import path from 'node:path';

const ANDROID_KEY = /^goog_[A-Za-z0-9]{27,28}$/;
const ADMOB_APP_ID = /^ca-app-pub-(?!3940256099942544)(\d{16})~\d{10}$/;
const ADMOB_UNIT_ID = /^ca-app-pub-(?!3940256099942544)(\d{16})\/\d{10}$/;
const CRASHLYTICS_CLASSPATH = "classpath 'com.google.firebase:firebase-crashlytics-gradle:3.0.7'";
const CRASHLYTICS_PLUGIN = "apply plugin: 'com.google.firebase.crashlytics'";
const RELEASE_LEAKAGE_KEYS = [
  'VITE_ENABLE_TEST_HARNESS',
  'VITE_SDK_VERIFIER_AUTOMOUNT',
  'VITE_SDK_VERIFIER_AUTOCRASH',
  'VITE_INSITU_TOUR',
  'VITE_INSITU_TOUR_STATE',
  'VITE_FTD_FAST_E2E_UI',
  'VITE_FTD_FORCE_CANVAS',
  'VITE_FTD_SIM_AUTOPLAY',
  'FTB_DEV_SHELL_URL',
];

export function verifyJarSignatureOutput(output, exitCode = 0) {
  if (!/\bjar verified(?:, with signer errors)?\./im.test(output)) throw new Error('AAB jar signature was not verified');
  if (/unsigned entr(?:y|ies)/i.test(output)) throw new Error('AAB contains unsigned entries');
  if (exitCode !== 0) {
    const errorBlock = /\nError:\s*\n([\s\S]*?)(?:\n\s*\nWarning:|$)/i.exec(output)?.[1] ?? '';
    const errors = errorBlock.split('\n').map((line) => line.trim()).filter(Boolean);
    const allowedError = (line) => (
      /^This jar contains entries whose certificate chain is invalid\./i.test(line)
      || /^This jar contains entries whose signer certificate is self-signed\.$/i.test(line)
    );
    if (errors.length === 0 || errors.some((line) => !allowedError(line))) {
      throw new Error('AAB failed strict verification for an unapproved reason');
    }
  }
  return true;
}

export function inspectBundleManifest(xml, expected) {
  const attribute = (name) => new RegExp(`(?:android:)?${name}="([^"]+)"`).exec(xml)?.[1] ?? null;
  if (attribute('package') !== expected.packageId) throw new Error(`AAB package does not equal ${expected.packageId}`);
  if (Number(attribute('versionCode')) !== expected.versionCode) throw new Error(`AAB versionCode does not equal ${expected.versionCode}`);
  if (attribute('versionName') !== expected.versionName) throw new Error(`AAB versionName does not equal ${expected.versionName}`);
  if (/android:debuggable="true"/.test(xml)) throw new Error('AAB application is debuggable');
  return expected;
}

export function materializeFirebaseConfig(source, destination, packageId) {
  const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
  const packages = parsed.client?.map((client) => client.client_info?.android_client_info?.package_name).filter(Boolean) ?? [];
  if (!packages.includes(packageId)) throw new Error(`Firebase config has no exact Android package ${packageId}`);
  if (path.resolve(source) === path.resolve(destination)) return destination;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return destination;
}

export function validateRecipe({ packageId, versionCode, versionName, env, files }) {
  const issues = [];
  if (!/^com\.basegamelab\.findthe(?:dog|bird)$/.test(packageId)) issues.push(`unapproved package: ${packageId}`);
  if (!Number.isInteger(versionCode) || versionCode < 1) issues.push('versionCode must be a positive integer');
  if (!/^\d+\.\d+\.\d+$/.test(versionName)) issues.push('versionName must be semantic x.y.z');
  if (!ANDROID_KEY.test(env.VITE_REVENUECAT_ANDROID_API_KEY ?? '')) issues.push('RevenueCat Android public key is absent or invalid');
  if (env.VITE_APPSFLYER_ENABLED !== 'true') issues.push('AppsFlyer must be enabled for production Android');
  if (env.VITE_ATTRIBUTION_PROVIDER !== 'appsflyer') issues.push('VITE_ATTRIBUTION_PROVIDER must equal appsflyer for production Android');
  if (!usableAppsFlyerDevKey(env.VITE_APPSFLYER_DEV_KEY)) issues.push('AppsFlyer dev key is absent, placeholder, or diagnostic');
  if (!([...files].some((file) => file.endsWith('AppsFlyerAttributionPlugin.java')))) issues.push('AppsFlyer selected but Android bridge is absent');
  if (env.VITE_ADMOB_ANDROID_ENABLED !== 'true') issues.push('AdMob must be enabled for production Android');
  if (!ADMOB_APP_ID.test(env.VITE_ADMOB_ANDROID_APP_ID ?? '')) issues.push('AdMob Android app ID is absent or invalid');
  for (const key of ['VITE_ADMOB_ANDROID_BANNER_ID', 'VITE_ADMOB_ANDROID_INTERSTITIAL_ID', 'VITE_ADMOB_ANDROID_REWARDED_ID']) {
    if (!ADMOB_UNIT_ID.test(env[key] ?? '')) issues.push(`${key} is absent or invalid`);
  }
  if (hasValue(env.VITE_ADMOB_ANDROID_TEST_MODE)) issues.push('VITE_ADMOB_ANDROID_TEST_MODE must be false or absent for production Android');
  if (hasValue(env.VITE_ADMOB_ANDROID_TEST_DEVICE_IDS)) issues.push('VITE_ADMOB_ANDROID_TEST_DEVICE_IDS must be absent for production Android');
  if (env.VITE_ADMOB_ANDROID_ENABLED === 'true' && ![...files].some((file) => file.endsWith('AndroidManifest.xml'))) issues.push('AdMob selected but AndroidManifest wiring is absent');
  if (env.VITE_FIREBASE_CRASHLYTICS_ENABLED === 'true' && ![...files].some((file) => file.endsWith('google-services.json'))) issues.push('Crashlytics selected but google-services.json is absent');
  if (env.VITE_META_ENABLED === 'true') issues.push('direct Meta events must remain off');
  for (const key of RELEASE_LEAKAGE_KEYS) if (hasValue(env[key])) issues.push(`${key} must be absent for production Android`);
  if (!path.isAbsolute(env.PLAY_UPLOAD_KEYSTORE_PATH ?? '')) issues.push('PLAY_UPLOAD_KEYSTORE_PATH must be an absolute protected path');
  for (const key of ['PLAY_UPLOAD_KEY_ALIAS', 'PLAY_UPLOAD_KEY_PASSWORD', 'PLAY_UPLOAD_STORE_PASSWORD']) if (!usableSecret(env[key])) issues.push(`${key} is absent or placeholder`);
  try { normalizeSha256(env.PLAY_UPLOAD_CERT_SHA256); } catch { issues.push('PLAY_UPLOAD_CERT_SHA256 is absent or invalid'); }
  return issues;
}

export function patchCrashlyticsRootGradle(content) {
  if (content.includes(CRASHLYTICS_CLASSPATH)) return content;
  const googleServices = /^(\s*)classpath ['"]com\.google\.gms:google-services:[^'"]+['"]\s*$/m;
  if (!googleServices.test(content)) throw new Error('android/build.gradle has no google-services classpath');
  return content.replace(googleServices, (line) => `${line}\n        ${CRASHLYTICS_CLASSPATH}`);
}

export function patchCrashlyticsAppGradle(content) {
  if (content.includes(CRASHLYTICS_PLUGIN)) return content;
  const googleServices = /^(\s*)apply plugin: ['"]com\.google\.gms\.google-services['"]\s*$/m;
  if (!googleServices.test(content)) throw new Error('android/app/build.gradle has no google-services plugin application');
  return content.replace(googleServices, (line) => `${line}\n${line.match(/^\s*/)[0]}${CRASHLYTICS_PLUGIN}`);
}

export function applyCrashlyticsGradle(androidDir) {
  for (const [relative, patch] of [
    ['build.gradle', patchCrashlyticsRootGradle],
    ['app/build.gradle', patchCrashlyticsAppGradle],
  ]) {
    const file = path.join(androidDir, relative);
    if (!fs.existsSync(file)) throw new Error(`generated Android file is absent: ${relative}`);
    const current = fs.readFileSync(file, 'utf8');
    const next = patch(current);
    if (next !== current) fs.writeFileSync(file, next);
  }
}

export function validateGeneratedAndroidProject({ androidDir, packageId, crashlyticsEnabled }) {
  const issues = [];
  const required = {
    'build.gradle': null,
    'app/build.gradle': ["apply from: 'find-game-providers.gradle'"],
    'app/find-game-providers.gradle': ['com.appsflyer:af-android-sdk', `applicationId '${packageId}'`],
    'app/src/main/AndroidManifest.xml': ['com.google.android.gms.ads.APPLICATION_ID', '${admobApplicationId}'],
    [`app/src/main/java/${packageId.replaceAll('.', '/')}/MainActivity.java`]: ['registerPlugin(AppsFlyerAttributionPlugin.class)'],
    [`app/src/main/java/${packageId.replaceAll('.', '/')}/sdk/AppsFlyerAttributionPlugin.java`]: ['class AppsFlyerAttributionPlugin'],
  };
  if (!fs.existsSync(path.join(androidDir, 'settings.gradle'))) {
    issues.push('generated Android project is absent; run android:add or android:sync before android:validate');
    return issues;
  }
  for (const [relative, snippets] of Object.entries(required)) {
    const file = path.join(androidDir, relative);
    if (!fs.existsSync(file)) {
      issues.push(`generated Android file is absent: ${relative}`);
      continue;
    }
    if (snippets) {
      const content = fs.readFileSync(file, 'utf8');
      for (const snippet of snippets) if (!content.includes(snippet)) issues.push(`generated ${relative} is missing ${snippet}`);
    }
  }
  if (crashlyticsEnabled) {
    const rootGradle = readIfPresent(path.join(androidDir, 'build.gradle'));
    const appGradle = readIfPresent(path.join(androidDir, 'app', 'build.gradle'));
    if (!rootGradle.includes(CRASHLYTICS_CLASSPATH)) issues.push('generated android/build.gradle is missing the Crashlytics classpath');
    if (!appGradle.includes(CRASHLYTICS_PLUGIN)) issues.push('generated android/app/build.gradle is missing the Crashlytics plugin');
    if (!fs.existsSync(path.join(androidDir, 'app', 'google-services.json'))) issues.push('generated Android project is missing google-services.json');
  }
  return issues;
}

export function resolveReleaseIdentity(env, base) {
  const rawCode = env.PLAY_VERSION_CODE;
  const versionName = env.PLAY_VERSION_NAME;
  if (!/^\d+$/.test(rawCode ?? '') || Number(rawCode) < 1) throw new Error('PLAY_VERSION_CODE must be a positive integer');
  if (!/^\d+\.\d+\.\d+$/.test(versionName ?? '')) throw new Error('PLAY_VERSION_NAME must be semantic x.y.z');
  return { packageId: base.packageId, versionCode: Number(rawCode), versionName };
}

export function normalizeSha256(value) {
  const normalized = (value ?? '').replace(/:/g, '').trim().toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(normalized)) throw new Error('upload certificate SHA-256 must contain exactly 64 hexadecimal characters');
  return normalized;
}

function usableSecret(value) {
  return typeof value === 'string' && value.trim().length > 6 && !value.includes('__SET_') && !value.includes('placeholder');
}

// AppsFlyer dev keys are 22 alphanumeric characters. Anything else (including
// the DIAGNOSTIC placeholder that once reached a physical build) fails closed.
const APPSFLYER_DEV_KEY = /^[A-Za-z0-9]{22}$/;
function usableAppsFlyerDevKey(value) {
  if (!usableSecret(value)) return false;
  const trimmed = value.trim();
  if (!APPSFLYER_DEV_KEY.test(trimmed)) return false;
  return !/diagnostic|notreal|placeholder|example|sample/i.test(trimmed);
}

function hasValue(value) {
  return typeof value === 'string' && value.trim() !== '' && value.trim().toLowerCase() !== 'false';
}

function readIfPresent(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

export function copyOverlay(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Android overlay is missing: ${source}`);
  fs.cpSync(source, destination, { recursive: true, force: true });
}
