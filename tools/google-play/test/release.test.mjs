import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectBundleManifest, materializeFirebaseConfig, normalizeSha256, resolveReleaseIdentity, validateRecipe } from '../src/release.mjs';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'google-play-release-'));
  roots.push(value);
  return value;
}

describe('Google Play release gates', () => {
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

  it('validates production identity and rejects selected-but-absent providers', () => {
    const issues = validateRecipe({
      packageId: 'com.basegamelab.findthebird', versionCode: 1, versionName: '1.0.0',
      env: { VITE_APPSFLYER_ENABLED: 'true' }, files: new Set(),
    });
    expect(issues.join('\n')).toMatch(/AppsFlyer.*bridge/);
    expect(issues.join('\n')).toMatch(/RevenueCat/);
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

  it('normalizes and validates protected upload certificate fingerprints', () => {
    const raw = Array(32).fill('ab').join(':');
    expect(normalizeSha256(raw)).toBe('AB'.repeat(32));
    expect(() => normalizeSha256('not-a-fingerprint')).toThrow(/SHA-256/);
  });
});
