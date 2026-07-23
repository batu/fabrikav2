import { describe, expect, it } from 'vitest';
import { createSdkContext } from '../../src/sdk/SdkContext';
import { computeIncludePlugins, firebaseConfigPresentInEnv } from '../../src/sdk/includePlugins';

const FULL_ENV = {
  VITE_APPLOVIN_IOS_ENABLED: 'true',
  VITE_APPLOVIN_IOS_GENERAL_AUDIENCE_ONLY: 'true',
  VITE_APPLOVIN_IOS_SDK_KEY: 'sdk-key',
  VITE_APPLOVIN_IOS_REWARDED_ID: 'rewarded-unit',
  VITE_APPLOVIN_ALLOW_PARTIAL_UNITS: 'true',
  VITE_APPSFLYER_ENABLED: 'true',
  VITE_APPSFLYER_DEV_KEY: 'fZvuk792H9hJQKmaTwuXxA',
  VITE_APPSFLYER_APPLE_APP_ID: '6793860059',
  VITE_FB_ENABLED: 'true',
  VITE_FB_APP_ID: '4138472436283342',
  VITE_FB_CLIENT_TOKEN: 'df7e72e4b37b02ff036dc836d8eea518',
  VITE_FIREBASE_API_KEY: 'k',
  VITE_FIREBASE_PROJECT_ID: 'p',
  VITE_FIREBASE_APP_ID: 'a',
};

describe('createSdkContext', () => {
  it('yields all-disabled providers and no extra sinks with an empty env (shell_template placeholder case)', () => {
    const context = createSdkContext({
      platform: 'ios',
      isNativePlatform: true,
      env: {},
      isProductionBuild: false,
    });

    expect(context.selection.ads).toBe('disabled');
    expect(context.selection.attribution).toBe('disabled');
    expect(context.selection.meta).toBe('meta-disabled');
    expect(context.extraSinks).toHaveLength(0);
    expect(context.meta.getStatus()).toMatchObject({ state: 'not-configured' });
  });

  it('selects applovin + appsflyer + meta + firebase sink with the full iOS env', () => {
    const context = createSdkContext({
      platform: 'ios',
      isNativePlatform: true,
      env: FULL_ENV,
      isProductionBuild: false,
    });

    expect(context.selection.ads).toBe('applovin-max');
    expect(context.selection.attribution).toBe('appsflyer');
    expect(context.selection.meta).toBe('meta-capacitor');
    expect(context.extraSinks).toHaveLength(1);
    expect(context.configuredIds.firebasePresent).toBe(true);
    expect(context.configuredIds.appsFlyerAppleAppId).toBe('6793860059');
  });

  it('never constructs the firebase sink on web even with firebase env present', () => {
    const context = createSdkContext({
      platform: 'web',
      isNativePlatform: false,
      env: FULL_ENV,
      isProductionBuild: false,
    });

    expect(context.extraSinks).toHaveLength(0);
    expect(context.selection.meta).toBe('meta-disabled');
  });
});

describe('includePlugins', () => {
  it('excludes the firebase pod when any firebase key is missing', () => {
    expect(firebaseConfigPresentInEnv({ VITE_FIREBASE_API_KEY: 'k' })).toBe(false);
    expect(computeIncludePlugins({})).not.toContain('@capacitor-firebase/analytics');
  });

  it('includes the firebase pod only with the complete triple', () => {
    const env = { VITE_FIREBASE_API_KEY: 'k', VITE_FIREBASE_PROJECT_ID: 'p', VITE_FIREBASE_APP_ID: 'a' };
    expect(computeIncludePlugins(env)).toContain('@capacitor-firebase/analytics');
  });
});
