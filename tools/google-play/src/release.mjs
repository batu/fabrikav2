import fs from 'node:fs';
import path from 'node:path';

const ANDROID_KEY = /^goog_[A-Za-z0-9]{28}$/;

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
  if (env.VITE_APPSFLYER_ENABLED === 'true' && ![...files].some((file) => file.endsWith('AppsFlyerAttributionPlugin.java'))) issues.push('AppsFlyer selected but Android bridge is absent');
  if (env.VITE_ADMOB_ANDROID_ENABLED === 'true' && !env.VITE_ADMOB_ANDROID_APP_ID) issues.push('AdMob selected but Android app ID is absent');
  if (env.VITE_FIREBASE_CRASHLYTICS_ENABLED === 'true' && ![...files].some((file) => file.endsWith('google-services.json'))) issues.push('Crashlytics selected but google-services.json is absent');
  if (env.VITE_META_ENABLED === 'true') issues.push('direct Meta events must remain off');
  return issues;
}

export function copyOverlay(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Android overlay is missing: ${source}`);
  fs.cpSync(source, destination, { recursive: true, force: true });
}
