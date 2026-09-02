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

  it('never includes AdMob in the ad-free iOS shell', () => {
    expect(computeIncludePlugins({
      VITE_ADMOB_IOS_ENABLED: 'true',
      VITE_ADMOB_IOS_APP_ID: 'ca-app-pub-1234567890123456~1234567890',
    })).not.toContain('@capacitor-community/admob');
  });

  it('never includes Firebase Analytics, even when legacy Firebase env is complete', () => {
    expect(computeIncludePlugins(completeFirebaseEnv)).not.toContain('@capacitor-firebase/analytics');
  });

  it('includes Crashlytics only when explicitly enabled and Firebase config is complete', () => {
    expect(computeIncludePlugins(completeFirebaseEnv)).not.toContain('@capacitor-firebase/crashlytics');
    expect(computeIncludePlugins({
      ...completeFirebaseEnv,
      VITE_FIREBASE_CRASHLYTICS_ENABLED: 'true',
    })).toContain('@capacitor-firebase/crashlytics');
  });

  it('excludes Crashlytics for partial config or explicit disablement', () => {
    expect(computeIncludePlugins({
      VITE_FIREBASE_CRASHLYTICS_ENABLED: 'true',
      VITE_FIREBASE_API_KEY: 'firebase-api-key',
      VITE_FIREBASE_PROJECT_ID: 'firebase-project-id',
    })).not.toContain('@capacitor-firebase/crashlytics');
    expect(computeIncludePlugins({
      ...completeFirebaseEnv,
      VITE_FIREBASE_CRASHLYTICS_ENABLED: 'false',
    })).not.toContain('@capacitor-firebase/crashlytics');
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
