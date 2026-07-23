import { describe, expect, it, vi } from 'vitest';
import { buildEntries, toggleSdkVerifierPane } from '../../src/devtools/SdkVerifierMount';
import { createSdkContext } from '../../src/sdk/SdkContext';

const emptyContext = () => createSdkContext({ platform: 'ios', isNativePlatform: true, env: {}, isProductionBuild: false });

describe('SdkVerifierMount', () => {
  it('builds four entries reporting not-configured states for an empty env', () => {
    const entries = buildEntries(emptyContext());

    expect(entries.map((e) => e.name)).toEqual([
      'ads (disabled)',
      'attribution (disabled)',
      'firebase analytics',
      'facebook (meta-disabled)',
    ]);
    expect(entries[2].getStatus()).toContain('not configured');
    expect(entries[3].getStatus()).toContain('not configured');
  });

  it('never exposes the full AppLovin sdk key in configured ids', () => {
    const context = createSdkContext({
      platform: 'ios',
      isNativePlatform: true,
      isProductionBuild: false,
      env: {
        VITE_APPLOVIN_IOS_ENABLED: 'true',
        VITE_APPLOVIN_IOS_GENERAL_AUDIENCE_ONLY: 'true',
        VITE_APPLOVIN_IOS_SDK_KEY: 'super-secret-applovin-key',
        VITE_APPLOVIN_IOS_REWARDED_ID: 'unit',
        VITE_APPLOVIN_ALLOW_PARTIAL_UNITS: 'true',
      },
    });

    const adsEntry = buildEntries(context)[0];
    expect(JSON.stringify(adsEntry.configuredIds)).not.toContain('super-secret-applovin-key');
    expect(adsEntry.configuredIds.rewarded).toBe('unit');
    expect(adsEntry.configuredIds.interstitial).toBeNull();
  });

  it('toggle mounts then unmounts the pane', () => {
    const context = emptyContext();

    expect(toggleSdkVerifierPane(context, document)).toBe(true);
    expect(document.querySelectorAll('[data-sdk]').length).toBeGreaterThan(0);
    expect(toggleSdkVerifierPane(context, document)).toBe(false);
    expect(document.querySelectorAll('[data-sdk]')).toHaveLength(0);
  });

  it('analytics action routes through the real AnalyticsService', async () => {
    const analyticsModule = await import('../../src/analytics/AnalyticsService');
    const spy = vi.spyOn(analyticsModule.analytics, 'settingsChanged').mockResolvedValue();

    const firebaseEntry = buildEntries(emptyContext())[2];
    await firebaseEntry.actions[0].run();

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ setting_name: 'sdk_verifier_ping' }));
    spy.mockRestore();
  });
});
