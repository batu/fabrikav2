import { describe, expect, it } from 'vitest';
import {
  ALWAYS_INCLUDED_PLUGINS,
  computeIncludePlugins,
  firebaseConfigPresentInEnv,
} from '../../src/sdk/includePlugins';

const completeFirebaseEnv = {
  VITE_FIREBASE_API_KEY: 'firebase-api-key',
  VITE_FIREBASE_PROJECT_ID: 'firebase-project-id',
  VITE_FIREBASE_APP_ID: 'firebase-app-id',
};

describe('capacitor includePlugins allowlist', () => {
  it('always includes the config-safe plugins', () => {
    expect(ALWAYS_INCLUDED_PLUGINS).toEqual([
      '@capacitor/app',
      '@capacitor/haptics',
      '@capacitor/local-notifications',
      '@revenuecat/purchases-capacitor',
    ]);
  });

  it('excludes @capacitor-firebase/analytics when Firebase config is absent', () => {
    const plugins = computeIncludePlugins({});
    expect(plugins).not.toContain('@capacitor-firebase/analytics');
    expect(plugins).toEqual([...ALWAYS_INCLUDED_PLUGINS]);
  });

  it('excludes @capacitor-firebase/analytics when Firebase config is partial', () => {
    expect(computeIncludePlugins({
      VITE_FIREBASE_API_KEY: 'firebase-api-key',
      VITE_FIREBASE_PROJECT_ID: 'firebase-project-id',
    })).not.toContain('@capacitor-firebase/analytics');
  });

  it('includes @capacitor-firebase/analytics only when Firebase config is complete', () => {
    const plugins = computeIncludePlugins(completeFirebaseEnv);
    expect(plugins).toContain('@capacitor-firebase/analytics');
  });

  it('treats blank/whitespace env values as absent', () => {
    expect(firebaseConfigPresentInEnv({
      VITE_FIREBASE_API_KEY: '  ',
      VITE_FIREBASE_PROJECT_ID: 'firebase-project-id',
      VITE_FIREBASE_APP_ID: 'firebase-app-id',
    })).toBe(false);
    expect(firebaseConfigPresentInEnv(completeFirebaseEnv)).toBe(true);
  });
});
