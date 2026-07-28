import { describe, expect, it } from 'vitest';
import { coerceEntries, readFetchCredentials } from '../../src/config/remoteConfigFetch';

describe('remote config fetch', () => {
  it('requires the full Firebase credential triple', () => {
    expect(readFetchCredentials({})).toBeNull();
    expect(
      readFetchCredentials({
        VITE_FIREBASE_PROJECT_ID: 'mable-run',
        VITE_FIREBASE_API_KEY: 'key',
      }),
    ).toBeNull();
    const credentials = readFetchCredentials({
      VITE_FIREBASE_PROJECT_ID: 'mable-run',
      VITE_FIREBASE_API_KEY: 'key',
      VITE_FIREBASE_APP_ID: 'app',
    });
    expect(credentials?.projectId).toBe('mable-run');
    expect(credentials?.appInstanceId).not.toBe('');
  });

  it('coerces remote strings onto the schema types', () => {
    expect(
      coerceEntries({
        interstitial_ads_enabled: 'false',
        interstitial_first_level: '15',
        interstitial_fail_cooldown_s: '45',
        rewarded_ads_enabled: 'true',
      }),
    ).toEqual({
      interstitialAdsEnabled: false,
      interstitialFirstLevel: 15,
      interstitialFailCooldownS: 45,
      rewardedAdsEnabled: true,
    });
  });

  it('drops unknown keys and unparseable values so a console typo falls back to the default', () => {
    expect(
      coerceEntries({
        not_a_marble_run_key: 'true',
        interstitial_first_level: 'ten',
        interstitial_ads_enabled: 'yes',
        interstitial_level_end_cooldown_s: '90',
      }),
    ).toEqual({ interstitialLevelEndCooldownS: 90 });
  });
});
