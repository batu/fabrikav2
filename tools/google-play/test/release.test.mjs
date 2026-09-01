import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectBundleManifest, materializeFirebaseConfig, validateRecipe } from '../src/release.mjs';

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
});
