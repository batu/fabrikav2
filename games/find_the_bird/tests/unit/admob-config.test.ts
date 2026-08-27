import { describe, expect, it } from 'vitest';
import { readAdMobIosConfig } from '../../src/ads/AdMobConfig';

const complete = {
  VITE_ADMOB_IOS_ENABLED: 'true',
  VITE_ADMOB_IOS_APP_ID: 'ca-app-pub-1234567890123456~1234567890',
  VITE_ADMOB_IOS_BANNER_ID: 'ca-app-pub-1234567890123456/1111111111',
  VITE_ADMOB_IOS_INTERSTITIAL_ID: 'ca-app-pub-1234567890123456/2222222222',
  VITE_ADMOB_IOS_REWARDED_ID: 'ca-app-pub-1234567890123456/3333333333',
  VITE_ADMOB_IOS_TEST_MODE: 'false',
  VITE_ADMOB_IOS_TEST_DEVICE_IDS: '',
};

describe('readAdMobIosConfig', () => {
  it('is disabled unless explicitly enabled', () => {
    expect(readAdMobIosConfig({})).toMatchObject({ enabled: false, missingKeys: [] });
  });

  it('uses committed public identifiers as production defaults', () => {
    const config = readAdMobIosConfig({}, {
      enabled: true,
      appId: complete.VITE_ADMOB_IOS_APP_ID,
      adUnits: {
        banner: complete.VITE_ADMOB_IOS_BANNER_ID,
        interstitial: complete.VITE_ADMOB_IOS_INTERSTITIAL_ID,
        rewarded: complete.VITE_ADMOB_IOS_REWARDED_ID,
      },
    });
    expect(config).toMatchObject({
      enabled: true,
      appId: complete.VITE_ADMOB_IOS_APP_ID,
      config: { iosRewardedAdUnitId: complete.VITE_ADMOB_IOS_REWARDED_ID },
    });
  });

  it('allows an explicit environment disable over committed defaults', () => {
    expect(readAdMobIosConfig({ VITE_ADMOB_IOS_ENABLED: 'false' }, {
      enabled: true,
      appId: complete.VITE_ADMOB_IOS_APP_ID,
      adUnits: {
        banner: complete.VITE_ADMOB_IOS_BANNER_ID,
        interstitial: complete.VITE_ADMOB_IOS_INTERSTITIAL_ID,
        rewarded: complete.VITE_ADMOB_IOS_REWARDED_ID,
      },
    })).toMatchObject({ enabled: false });
  });

  it('accepts complete production identifiers without sample defaults', () => {
    expect(readAdMobIosConfig(complete)).toEqual({
      enabled: true,
      appId: complete.VITE_ADMOB_IOS_APP_ID,
      config: {
        enabled: true,
        isTesting: false,
        iosBannerAdUnitId: complete.VITE_ADMOB_IOS_BANNER_ID,
        iosInterstitialAdUnitId: complete.VITE_ADMOB_IOS_INTERSTITIAL_ID,
        iosRewardedAdUnitId: complete.VITE_ADMOB_IOS_REWARDED_ID,
        androidBannerAdUnitId: '',
        androidInterstitialAdUnitId: '',
        androidRewardedAdUnitId: '',
        testingDevices: [],
      },
    });
  });

  it('fails closed for partial, malformed, or Google sample configuration', () => {
    expect(readAdMobIosConfig({ ...complete, VITE_ADMOB_IOS_REWARDED_ID: '' })).toMatchObject({
      enabled: false,
      missingKeys: ['VITE_ADMOB_IOS_REWARDED_ID'],
    });
    expect(readAdMobIosConfig({ ...complete, VITE_ADMOB_IOS_APP_ID: 'not-an-app-id' })).toMatchObject({
      enabled: false,
      invalidKeys: ['VITE_ADMOB_IOS_APP_ID'],
    });
    expect(readAdMobIosConfig({
      ...complete,
      VITE_ADMOB_IOS_BANNER_ID: 'ca-app-pub-3940256099942544/2934735716',
    })).toMatchObject({ enabled: false, invalidKeys: ['VITE_ADMOB_IOS_BANNER_ID'] });
  });

  it('requires registered device identifiers for test traffic', () => {
    expect(readAdMobIosConfig({ ...complete, VITE_ADMOB_IOS_TEST_MODE: 'true' })).toMatchObject({
      enabled: false,
      missingKeys: ['VITE_ADMOB_IOS_TEST_DEVICE_IDS'],
    });
    expect(readAdMobIosConfig({
      ...complete,
      VITE_ADMOB_IOS_TEST_MODE: 'true',
      VITE_ADMOB_IOS_TEST_DEVICE_IDS: 'device-a, device-b',
    })).toMatchObject({ enabled: true, config: { isTesting: true, testingDevices: ['device-a', 'device-b'] } });
  });
});
