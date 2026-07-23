import { describe, expect, it } from 'vitest';
import { readAppLovinConfigForPlatform } from './AppLovinConfig.ts';

const fullIosEnv = {
  VITE_APPLOVIN_IOS_ENABLED: 'true',
  VITE_APPLOVIN_IOS_GENERAL_AUDIENCE_ONLY: 'true',
  VITE_APPLOVIN_IOS_SDK_KEY: 'sdk-key-abcdef',
  VITE_APPLOVIN_IOS_BANNER_ID: 'banner-unit',
  VITE_APPLOVIN_IOS_INTERSTITIAL_ID: 'interstitial-unit',
  VITE_APPLOVIN_IOS_REWARDED_ID: 'rewarded-unit',
};

describe('readAppLovinConfigForPlatform', (): void => {
  it('is disabled + not-requested when the enable flag is off', (): void => {
    const result = readAppLovinConfigForPlatform('ios', {});
    expect(result.enabled).toBe(false);
    if (!result.enabled) {
      expect(result.requested).toBe(false);
      expect(result.missingKeys).toEqual([]);
    }
  });

  it('is disabled + requested when general-audience-only is not affirmed', (): void => {
    const result = readAppLovinConfigForPlatform('ios', { VITE_APPLOVIN_IOS_ENABLED: 'true' });
    expect(result.enabled).toBe(false);
    if (!result.enabled) {
      expect(result.requested).toBe(true);
    }
  });

  it('reports every missing key when enabled but unconfigured', (): void => {
    const result = readAppLovinConfigForPlatform('ios', {
      VITE_APPLOVIN_IOS_ENABLED: 'true',
      VITE_APPLOVIN_IOS_GENERAL_AUDIENCE_ONLY: 'true',
    });
    expect(result.enabled).toBe(false);
    if (!result.enabled) {
      expect(result.missingKeys).toEqual([
        'VITE_APPLOVIN_IOS_SDK_KEY',
        'VITE_APPLOVIN_IOS_BANNER_ID',
        'VITE_APPLOVIN_IOS_INTERSTITIAL_ID',
        'VITE_APPLOVIN_IOS_REWARDED_ID',
      ]);
    }
  });

  it('returns a fully-formed config when enabled and configured', (): void => {
    const result = readAppLovinConfigForPlatform('ios', fullIosEnv);
    expect(result.enabled).toBe(true);
    if (result.enabled) {
      expect(result.platform).toBe('ios');
      expect(result.config.sdkKey).toBe('sdk-key-abcdef');
      expect(result.config.adUnitIds).toEqual({
        banner: 'banner-unit',
        interstitial: 'interstitial-unit',
        rewarded: 'rewarded-unit',
      });
      expect(result.config.privacy.generalAudienceOnly).toBe(true);
    }
  });
});

describe('readAppLovinConfigForPlatform partial-units mode', (): void => {
  const partialEnv = {
    VITE_APPLOVIN_IOS_ENABLED: 'true',
    VITE_APPLOVIN_IOS_GENERAL_AUDIENCE_ONLY: 'true',
    VITE_APPLOVIN_IOS_SDK_KEY: 'sdk-key-abcdef',
    VITE_APPLOVIN_IOS_REWARDED_ID: 'rewarded-unit',
    VITE_APPLOVIN_ALLOW_PARTIAL_UNITS: 'true',
  };

  it('enables with one unit id, blanking the unconfigured formats', (): void => {
    const result = readAppLovinConfigForPlatform('ios', partialEnv);
    expect(result.enabled).toBe(true);
    if (result.enabled) {
      expect(result.config.adUnitIds).toEqual({
        banner: '',
        interstitial: '',
        rewarded: 'rewarded-unit',
      });
    }
  });

  it('still requires the sdk key in partial mode', (): void => {
    const { VITE_APPLOVIN_IOS_SDK_KEY: _omitted, ...withoutKey } = partialEnv;
    const result = readAppLovinConfigForPlatform('ios', withoutKey);
    expect(result.enabled).toBe(false);
    if (!result.enabled) {
      expect(result.missingKeys).toEqual(['VITE_APPLOVIN_IOS_SDK_KEY']);
    }
  });

  it('stays disabled when no unit id is present even in partial mode', (): void => {
    const result = readAppLovinConfigForPlatform('ios', {
      VITE_APPLOVIN_IOS_ENABLED: 'true',
      VITE_APPLOVIN_IOS_GENERAL_AUDIENCE_ONLY: 'true',
      VITE_APPLOVIN_IOS_SDK_KEY: 'sdk-key-abcdef',
      VITE_APPLOVIN_ALLOW_PARTIAL_UNITS: 'true',
    });
    expect(result.enabled).toBe(false);
    if (!result.enabled) {
      expect(result.missingKeys).toEqual([
        'VITE_APPLOVIN_IOS_BANNER_ID',
        'VITE_APPLOVIN_IOS_INTERSTITIAL_ID',
        'VITE_APPLOVIN_IOS_REWARDED_ID',
      ]);
    }
  });

  it('keeps the strict all-units contract when the flag is absent', (): void => {
    const { VITE_APPLOVIN_ALLOW_PARTIAL_UNITS: _flag, ...strictPartial } = partialEnv;
    const result = readAppLovinConfigForPlatform('ios', strictPartial);
    expect(result.enabled).toBe(false);
    if (!result.enabled) {
      expect(result.missingKeys).toEqual([
        'VITE_APPLOVIN_IOS_BANNER_ID',
        'VITE_APPLOVIN_IOS_INTERSTITIAL_ID',
      ]);
    }
  });
});
