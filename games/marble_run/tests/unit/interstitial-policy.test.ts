import { describe, expect, it } from 'vitest';
import { decideInterstitial, type InterstitialPolicyConfig } from '../../src/ads/interstitialPolicy';
import { REMOTE_CONFIG_DEFAULTS } from '../../src/config/remoteConfigSchema';

/** The publisher's launch numbers: ad-free < 10, fail-only 10..19, all ends >= 20. */
const config: InterstitialPolicyConfig = {
  enabled: true,
  firstLevel: 10,
  failOnlyUntilLevel: 20,
  failCooldownS: 90,
  levelEndCooldownS: 90,
};

describe('interstitial policy', () => {
  it('matches the shipped remote-config defaults', () => {
    expect(REMOTE_CONFIG_DEFAULTS.interstitialAdsEnabled).toBe(true);
    expect(REMOTE_CONFIG_DEFAULTS.interstitialFirstLevel).toBe(10);
    expect(REMOTE_CONFIG_DEFAULTS.interstitialFailOnlyUntilLevel).toBe(20);
    expect(REMOTE_CONFIG_DEFAULTS.interstitialFailCooldownS).toBe(90);
    expect(REMOTE_CONFIG_DEFAULTS.interstitialLevelEndCooldownS).toBe(90);
    expect(REMOTE_CONFIG_DEFAULTS.rewardedAdsEnabled).toBe(true);
  });

  it('shows nothing below the first eligible level, on either outcome', () => {
    for (const trigger of ['level_complete', 'level_fail'] as const) {
      for (const levelNumber of [1, 5, 9]) {
        expect(decideInterstitial({ levelNumber, trigger, config })).toEqual({
          allowed: false,
          reason: 'below-first-level',
        });
      }
    }
  });

  it('shows only after a fail inside the fail-only window', () => {
    for (const levelNumber of [10, 15, 19]) {
      expect(decideInterstitial({ levelNumber, trigger: 'level_fail', config })).toEqual({
        allowed: true,
        minIntervalMs: 90_000,
      });
      expect(decideInterstitial({ levelNumber, trigger: 'level_complete', config })).toEqual({
        allowed: false,
        reason: 'fail-only-window',
      });
    }
  });

  it('allows both outcomes from the fail-only boundary on', () => {
    for (const levelNumber of [20, 21, 110]) {
      expect(decideInterstitial({ levelNumber, trigger: 'level_complete', config }).allowed).toBe(true);
      expect(decideInterstitial({ levelNumber, trigger: 'level_fail', config }).allowed).toBe(true);
    }
  });

  it('carries each trigger its own cooldown so the two tune independently', () => {
    const split: InterstitialPolicyConfig = { ...config, failCooldownS: 30, levelEndCooldownS: 120 };
    expect(decideInterstitial({ levelNumber: 25, trigger: 'level_fail', config: split })).toEqual({
      allowed: true,
      minIntervalMs: 30_000,
    });
    expect(decideInterstitial({ levelNumber: 25, trigger: 'level_complete', config: split })).toEqual({
      allowed: true,
      minIntervalMs: 120_000,
    });
  });

  it('honours the kill switch above every other gate', () => {
    const off: InterstitialPolicyConfig = { ...config, enabled: false };
    expect(decideInterstitial({ levelNumber: 999, trigger: 'level_fail', config: off })).toEqual({
      allowed: false,
      reason: 'disabled',
    });
  });

  it('clamps a negative cooldown instead of passing a negative interval to the provider', () => {
    const negative: InterstitialPolicyConfig = { ...config, failCooldownS: -5 };
    expect(decideInterstitial({ levelNumber: 30, trigger: 'level_fail', config: negative })).toEqual({
      allowed: true,
      minIntervalMs: 0,
    });
  });
});
