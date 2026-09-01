import fs from 'node:fs';
import path from 'node:path';

const ANDROID_KEY = /^goog_[A-Za-z0-9]{28}$/;
const ADMOB_APP_ID = /^ca-app-pub-(?!3940256099942544)(\d{16})~\d{10}$/;
const ADMOB_UNIT_ID = /^ca-app-pub-(?!3940256099942544)(\d{16})\/\d{10}$/;

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
  if (!usableSecret(env.VITE_APPSFLYER_DEV_KEY)) issues.push('AppsFlyer dev key is absent or placeholder');
  if (!([...files].some((file) => file.endsWith('AppsFlyerAttributionPlugin.java')))) issues.push('AppsFlyer selected but Android bridge is absent');
  if (env.VITE_ADMOB_ANDROID_ENABLED !== 'true') issues.push('AdMob must be enabled for production Android');
  if (!ADMOB_APP_ID.test(env.VITE_ADMOB_ANDROID_APP_ID ?? '')) issues.push('AdMob Android app ID is absent or invalid');
  for (const key of ['VITE_ADMOB_ANDROID_BANNER_ID', 'VITE_ADMOB_ANDROID_INTERSTITIAL_ID', 'VITE_ADMOB_ANDROID_REWARDED_ID']) {
    if (!ADMOB_UNIT_ID.test(env[key] ?? '')) issues.push(`${key} is absent or invalid`);
  }
  if (env.VITE_ADMOB_ANDROID_ENABLED === 'true' && ![...files].some((file) => file.endsWith('AndroidManifest.xml'))) issues.push('AdMob selected but AndroidManifest wiring is absent');
  if (env.VITE_FIREBASE_CRASHLYTICS_ENABLED === 'true' && ![...files].some((file) => file.endsWith('google-services.json'))) issues.push('Crashlytics selected but google-services.json is absent');
  if (env.VITE_META_ENABLED === 'true') issues.push('direct Meta events must remain off');
  if (!path.isAbsolute(env.PLAY_UPLOAD_KEYSTORE_PATH ?? '')) issues.push('PLAY_UPLOAD_KEYSTORE_PATH must be an absolute protected path');
  for (const key of ['PLAY_UPLOAD_KEY_ALIAS', 'PLAY_UPLOAD_KEY_PASSWORD', 'PLAY_UPLOAD_STORE_PASSWORD']) if (!usableSecret(env[key])) issues.push(`${key} is absent or placeholder`);
  try { normalizeSha256(env.PLAY_UPLOAD_CERT_SHA256); } catch { issues.push('PLAY_UPLOAD_CERT_SHA256 is absent or invalid'); }
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

export function copyOverlay(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Android overlay is missing: ${source}`);
  fs.cpSync(source, destination, { recursive: true, force: true });
}
