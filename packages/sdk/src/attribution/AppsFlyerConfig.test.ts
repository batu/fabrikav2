import { describe, expect, it } from 'vitest';
import { readAppsFlyerConfig, redactAppsFlyerKey } from './AppsFlyerConfig.ts';

const DEV_KEY = 'fZvuk792H9hJQKmaTwuXxA';
const APPLE_APP_ID = '6793860059';

const enabledEnv = {
  VITE_APPSFLYER_ENABLED: 'true',
  VITE_APPSFLYER_DEV_KEY: DEV_KEY,
  VITE_APPSFLYER_APPLE_APP_ID: APPLE_APP_ID,
};

describe('readAppsFlyerConfig', (): void => {
  it('enables iOS with dev key and numeric apple app id', (): void => {
    const result = readAppsFlyerConfig('ios', enabledEnv, false);

    expect(result).toEqual({
      enabled: true,
      config: {
        devKey: DEV_KEY,
        appleAppId: APPLE_APP_ID,
        debugLogging: false,
        attWaitSeconds: 60,
      },
    });
  });

  it('enables Android with dev key alone and no apple app id', (): void => {
    const result = readAppsFlyerConfig(
      'android',
      { VITE_APPSFLYER_ENABLED: 'true', VITE_APPSFLYER_DEV_KEY: DEV_KEY },
      false,
    );

    expect(result.enabled).toBe(true);
    if (result.enabled) {
      expect(result.config.appleAppId).toBeNull();
      expect(result.config.attWaitSeconds).toBe(0);
    }
  });

  it('disables when the enable flag is absent', (): void => {
    const result = readAppsFlyerConfig('ios', { VITE_APPSFLYER_DEV_KEY: DEV_KEY }, false);

    expect(result).toMatchObject({ enabled: false, reason: 'VITE_APPSFLYER_ENABLED is not true' });
  });

  it('disables off native platforms with a platform reason', (): void => {
    const web = readAppsFlyerConfig('web', enabledEnv, false);
    const blank = readAppsFlyerConfig('', enabledEnv, false);

    expect(web).toMatchObject({ enabled: false, reason: 'AppsFlyer disabled on web platform' });
    expect(blank).toMatchObject({ enabled: false, reason: 'AppsFlyer disabled on web platform' });
  });

  it('names missing keys per platform', (): void => {
    const ios = readAppsFlyerConfig('ios', { VITE_APPSFLYER_ENABLED: 'true' }, false);
    const iosNoAppId = readAppsFlyerConfig(
      'ios',
      { VITE_APPSFLYER_ENABLED: 'true', VITE_APPSFLYER_DEV_KEY: DEV_KEY },
      false,
    );
    const android = readAppsFlyerConfig('android', { VITE_APPSFLYER_ENABLED: 'true' }, false);

    expect(ios).toMatchObject({
      enabled: false,
      missingKeys: ['VITE_APPSFLYER_DEV_KEY', 'VITE_APPSFLYER_APPLE_APP_ID'],
    });
    expect(iosNoAppId).toMatchObject({ enabled: false, missingKeys: ['VITE_APPSFLYER_APPLE_APP_ID'] });
    expect(android).toMatchObject({ enabled: false, missingKeys: ['VITE_APPSFLYER_DEV_KEY'] });
  });

  it('rejects a non-numeric apple app id', (): void => {
    const result = readAppsFlyerConfig(
      'ios',
      { ...enabledEnv, VITE_APPSFLYER_APPLE_APP_ID: 'id6793860059' },
      false,
    );

    expect(result).toMatchObject({
      enabled: false,
      reason: 'VITE_APPSFLYER_APPLE_APP_ID must be the numeric App Store id',
      missingKeys: [],
    });
  });

  it('only allows debug logging in non-production builds', (): void => {
    const debugEnv = { ...enabledEnv, VITE_APPSFLYER_DEBUG_LOGGING: 'true' };
    const dev = readAppsFlyerConfig('ios', debugEnv, false);
    const prod = readAppsFlyerConfig('ios', debugEnv, true);

    expect(dev.enabled && dev.config.debugLogging).toBe(true);
    expect(prod.enabled && prod.config.debugLogging).toBe(false);
  });
});

describe('redactAppsFlyerKey', (): void => {
  it('keeps only the last four characters of long keys', (): void => {
    expect(redactAppsFlyerKey(DEV_KEY)).toBe('<redacted:wuXxA>'.replace('wuXxA', DEV_KEY.slice(-4)));
    expect(redactAppsFlyerKey('short')).toBe('<redacted>');
  });
});
