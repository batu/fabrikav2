import { describe, expect, it } from 'vitest';
import { readAdMobIosConfig } from '../../src/ads/AdMobConfig';

describe('readAdMobIosConfig', () => {
  it('keeps the production iOS shell ad-free even when stale AdMob values are present', () => {
    expect(readAdMobIosConfig({})).toMatchObject({
      enabled: false,
      reason: 'iOS ads are disabled by release policy',
    });
    expect(readAdMobIosConfig({
      VITE_ADMOB_IOS_ENABLED: 'true',
      VITE_ADMOB_IOS_APP_ID: 'ca-app-pub-1234567890123456~1234567890',
    })).toEqual({
      enabled: false,
      reason: 'iOS ads are disabled by release policy',
      missingKeys: [],
      invalidKeys: [],
    });
  });
});
