import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyCrashlyticsGradle,
  inspectBundleManifest,
  materializeFirebaseConfig,
  normalizeSha256,
  patchCrashlyticsAppGradle,
  patchCrashlyticsRootGradle,
  resolveReleaseIdentity,
  verifyJarSignatureOutput,
  validateGeneratedAndroidProject,
  validateRecipe,
} from '../src/release.mjs';

const toolRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(toolRoot, '..', '..');

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'google-play-release-'));
  roots.push(value);
  return value;
}

function productionEnv(overrides = {}) {
  return {
    PLAY_VERSION_CODE: '7',
    PLAY_VERSION_NAME: '1.2.3',
    VITE_REVENUECAT_ANDROID_API_KEY: `goog_${'a'.repeat(28)}`,
    VITE_APPSFLYER_ENABLED: 'true',
    VITE_APPSFLYER_DEV_KEY: 'ownerKeyForTest0000000',
    VITE_ATTRIBUTION_PROVIDER: 'appsflyer',
    VITE_ADMOB_ANDROID_ENABLED: 'true',
    VITE_ADMOB_ANDROID_APP_ID: 'ca-app-pub-1234567890123456~4444444444',
    VITE_ADMOB_ANDROID_BANNER_ID: 'ca-app-pub-1234567890123456/5555555555',
    VITE_ADMOB_ANDROID_INTERSTITIAL_ID: 'ca-app-pub-1234567890123456/6666666666',
    VITE_ADMOB_ANDROID_REWARDED_ID: 'ca-app-pub-1234567890123456/7777777777',
    VITE_ADMOB_ANDROID_TEST_MODE: 'false',
    VITE_ADMOB_ANDROID_TEST_DEVICE_IDS: '',
    VITE_FIREBASE_CRASHLYTICS_ENABLED: 'false',
    VITE_META_ENABLED: 'false',
    PLAY_UPLOAD_KEYSTORE_PATH: '/protected/upload.jks',
    PLAY_UPLOAD_KEY_ALIAS: 'upload-alias',
    PLAY_UPLOAD_KEY_PASSWORD: 'protected-password',
    PLAY_UPLOAD_STORE_PASSWORD: 'protected-password',
    PLAY_UPLOAD_CERT_SHA256: 'AB'.repeat(32),
    ...overrides,
  };
}

describe('Google Play release gates', () => {
  it('requires strict jarsigner verification and rejects genuinely unsigned entries', () => {
    const expectedStrictAabOutput = [
      'jar verified, with signer errors.',
      '',
      'Error:',
      'This jar contains entries whose certificate chain is invalid. Reason: PKIX path building failed',
      'This jar contains entries whose signer certificate is self-signed.',
      '',
      'Warning:',
      'This jar contains signatures that do not include a timestamp.',
      '- Entry base/manifest/AndroidManifest.xml is signed in JarFile but is not signed in JarInputStream',
    ].join('\n');
    expect(() => verifyJarSignatureOutput('jar is unsigned.', 0)).toThrow(/not verified/);
    expect(() => verifyJarSignatureOutput(`${expectedStrictAabOutput}\nThis jar contains unsigned entries which have not been integrity-checked.`, 4)).toThrow(/unsigned entries/);
    expect(() => verifyJarSignatureOutput('jar verified.\nWarning: certificate chain is invalid.', 4)).toThrow(/strict verification/);
    expect(verifyJarSignatureOutput(expectedStrictAabOutput, 4)).toBe(true);
    expect(verifyJarSignatureOutput('jar verified.', 0)).toBe(true);
  });

  it('rejects an AAB manifest with the wrong identity, debug mode, or version', () => {
    expect(() => inspectBundleManifest('<manifest package="com.bad"><uses-sdk/></manifest>', {
      packageId: 'com.basegamelab.findthedog', versionCode: 1, versionName: '1.0.0',
    })).toThrow(/package/);
    expect(() => inspectBundleManifest('<manifest package="com.basegamelab.findthedog" android:versionCode="1" android:versionName="1.0.0"><application android:debuggable="true"/></manifest>', {
      packageId: 'com.basegamelab.findthedog', versionCode: 1, versionName: '1.0.0',
    })).toThrow(/debuggable/);
  });

  it('materializes only an exact-package Firebase config and otherwise fails closed', () => {
    const dir = root();
    const source = path.join(dir, 'google-services.json');
    fs.writeFileSync(source, JSON.stringify({ client: [{ client_info: { android_client_info: { package_name: 'com.bad' } } }] }));
    expect(() => materializeFirebaseConfig(source, path.join(dir, 'out.json'), 'com.basegamelab.findthebird')).toThrow(/package/);
  });

  it('accepts current 27-character RevenueCat Google Play key suffixes', () => {
    const issues = validateRecipe({
      packageId: 'com.basegamelab.findthebird', versionCode: 1, versionName: '1.0.0',
      env: productionEnv({ VITE_REVENUECAT_ANDROID_API_KEY: `goog_${'a'.repeat(27)}` }),
      files: new Set(['AppsFlyerAttributionPlugin.java', 'AndroidManifest.xml']),
    });
    expect(issues.join('\n')).not.toMatch(/RevenueCat/);
  });

  it('validates production identity and rejects selected-but-absent providers', () => {
    const issues = validateRecipe({
      packageId: 'com.basegamelab.findthebird', versionCode: 1, versionName: '1.0.0',
      env: { VITE_APPSFLYER_ENABLED: 'true' }, files: new Set(),
    });
    expect(issues.join('\n')).toMatch(/AppsFlyer.*bridge/);
    expect(issues.join('\n')).toMatch(/RevenueCat/);
  });

  it('rejects diagnostic and placeholder AppsFlyer dev keys in production Android', () => {
    for (const bad of ['DIAGNOSTICnotRealDevKey00', 'not-a-real-key-000000', 'placeholder-dev-key-1', '__SET_ME__abcdefghijk']) {
      const issues = validateRecipe({
        packageId: 'com.basegamelab.findthedog', versionCode: 1, versionName: '1.0.5',
        env: productionEnv({ VITE_APPSFLYER_DEV_KEY: bad }),
        files: new Set(['AppsFlyerAttributionPlugin.java', 'AndroidManifest.xml']),
      });
      expect(issues.join('\n'), bad).toMatch(/AppsFlyer dev key/);
    }
    const ok = validateRecipe({
      packageId: 'com.basegamelab.findthedog', versionCode: 1, versionName: '1.0.5',
      env: productionEnv({ VITE_APPSFLYER_DEV_KEY: 'a1B2c3D4e5F6g7H8i9J0kL' }),
      files: new Set(['AppsFlyerAttributionPlugin.java', 'AndroidManifest.xml']),
    });
    expect(ok.join('\n')).not.toMatch(/AppsFlyer dev key/);
  });

  it('requires Android manifest wiring when AdMob is selected', () => {
    const issues = validateRecipe({
      packageId: 'com.basegamelab.findthebird', versionCode: 1, versionName: '1.2.0',
      env: {
        VITE_REVENUECAT_ANDROID_API_KEY: `goog_${'a'.repeat(28)}`,
        VITE_ADMOB_ANDROID_ENABLED: 'true',
        VITE_ADMOB_ANDROID_APP_ID: 'ca-app-pub-1234567890123456~4444444444',
      },
      files: new Set(['AppsFlyerAttributionPlugin.java']),
    });
    expect(issues.join('\n')).toMatch(/AdMob.*AndroidManifest/);
  });

  it('requires the approved production providers and version seams', () => {
    expect(validateRecipe({ packageId: 'com.basegamelab.findthebird', versionCode: 2, versionName: '1.2.1', env: {}, files: new Set() }).join('\n'))
      .toMatch(/AppsFlyer must be enabled[\s\S]*AdMob must be enabled/);
    expect(() => resolveReleaseIdentity({ PLAY_VERSION_CODE: '', PLAY_VERSION_NAME: '' }, { packageId: 'com.basegamelab.findthebird' })).toThrow(/PLAY_VERSION_CODE/);
    expect(resolveReleaseIdentity({ PLAY_VERSION_CODE: '2', PLAY_VERSION_NAME: '1.2.1' }, { packageId: 'com.basegamelab.findthebird' }))
      .toEqual({ packageId: 'com.basegamelab.findthebird', versionCode: 2, versionName: '1.2.1' });
  });

  it('requires AppsFlyer to be the selected attribution provider', () => {
    const issues = validateRecipe({
      packageId: 'com.basegamelab.findthebird', versionCode: 7, versionName: '1.2.3',
      env: productionEnv({ VITE_ATTRIBUTION_PROVIDER: 'auto' }),
      files: new Set(['AppsFlyerAttributionPlugin.java', 'AndroidManifest.xml']),
    });
    expect(issues).toContain('VITE_ATTRIBUTION_PROVIDER must equal appsflyer for production Android');
  });

  it.each([
    ['VITE_ADMOB_ANDROID_TEST_MODE', 'true'],
    ['VITE_ADMOB_ANDROID_TEST_DEVICE_IDS', 'device-a'],
    ['VITE_ENABLE_TEST_HARNESS', 'true'],
    ['VITE_SDK_VERIFIER_AUTOMOUNT', 'true'],
    ['VITE_SDK_VERIFIER_AUTOCRASH', 'true'],
    ['VITE_INSITU_TOUR', 'allstates'],
    ['VITE_INSITU_TOUR_STATE', 'win'],
    ['VITE_FTD_FAST_E2E_UI', 'true'],
    ['VITE_FTD_FORCE_CANVAS', 'true'],
    ['VITE_FTD_SIM_AUTOPLAY', 'true'],
    ['FTB_DEV_SHELL_URL', 'http://127.0.0.1:5173'],
  ])('rejects production leakage through %s', (key, value) => {
    const issues = validateRecipe({
      packageId: 'com.basegamelab.findthedog', versionCode: 7, versionName: '1.2.3',
      env: productionEnv({ [key]: value }),
      files: new Set(['AppsFlyerAttributionPlugin.java', 'AndroidManifest.xml']),
    });
    expect(issues.join('\n')).toMatch(new RegExp(key));
  });

  it('patches both generated Gradle files with the Crashlytics plugin idempotently', () => {
    const rootGradle = `buildscript {\n  dependencies {\n    classpath 'com.google.gms:google-services:4.4.4'\n  }\n}`;
    const appGradle = `try {\n    if (file('google-services.json').text) {\n        apply plugin: 'com.google.gms.google-services'\n    }\n}`;
    const patchedRoot = patchCrashlyticsRootGradle(rootGradle);
    const patchedApp = patchCrashlyticsAppGradle(appGradle);
    expect(patchedRoot).toContain("classpath 'com.google.firebase:firebase-crashlytics-gradle:3.0.7'");
    expect(patchedApp).toContain("apply plugin: 'com.google.firebase.crashlytics'");
    expect(patchCrashlyticsRootGradle(patchedRoot)).toBe(patchedRoot);
    expect(patchCrashlyticsAppGradle(patchedApp)).toBe(patchedApp);
  });

  it('applies Crashlytics configuration to generated Gradle files', () => {
    const dir = root();
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'build.gradle'), "buildscript { dependencies {\n classpath 'com.google.gms:google-services:4.4.4'\n} }");
    fs.writeFileSync(path.join(dir, 'app', 'build.gradle'), "try {\n  apply plugin: 'com.google.gms.google-services'\n}");
    applyCrashlyticsGradle(dir);
    expect(fs.readFileSync(path.join(dir, 'build.gradle'), 'utf8')).toContain('firebase-crashlytics-gradle:3.0.7');
    expect(fs.readFileSync(path.join(dir, 'app', 'build.gradle'), 'utf8')).toContain('com.google.firebase.crashlytics');
  });

  it('requires generated Android files and verifies applied bridges and plugins', () => {
    const dir = root();
    expect(validateGeneratedAndroidProject({ androidDir: dir, packageId: 'com.basegamelab.findthebird', crashlyticsEnabled: false }).join('\n'))
      .toMatch(/generated Android project/);
    fs.writeFileSync(path.join(dir, 'settings.gradle'), '');
    expect(validateGeneratedAndroidProject({ androidDir: dir, packageId: 'com.basegamelab.findthebird', crashlyticsEnabled: true }).join('\n'))
      .toMatch(/find-game-providers[\s\S]*AppsFlyerAttributionPlugin[\s\S]*Crashlytics classpath/);
  });

  it('runs the source-recipe CLI from the real npm workspace CWD', () => {
    const result = spawnSync(process.execPath, [path.join(toolRoot, 'cli.mjs'), 'validate-source', '--game=find_the_bird'], {
      cwd: path.join(repoRoot, 'games', 'find_the_bird'),
      env: { ...process.env, ...productionEnv() },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Validated find_the_bird Android source recipe');
  });

  it('does not let android:validate pass without a generated project', () => {
    const result = spawnSync(process.execPath, [path.join(toolRoot, 'cli.mjs'), 'validate', '--game=find_the_dog'], {
      cwd: path.join(repoRoot, 'games', 'find_the_dog'),
      env: { ...process.env, ...productionEnv() },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/generated Android project is absent/);
    expect(result.stderr).not.toMatch(/games\/find_the_dog\/games\/find_the_dog/);
  });

  it('normalizes and validates protected upload certificate fingerprints', () => {
    const raw = Array(32).fill('ab').join(':');
    expect(normalizeSha256(raw)).toBe('AB'.repeat(32));
    expect(() => normalizeSha256('not-a-fingerprint')).toThrow(/SHA-256/);
  });
});
