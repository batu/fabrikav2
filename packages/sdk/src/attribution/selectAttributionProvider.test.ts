import { describe, expect, it, vi } from 'vitest';
import type { AdjustConfigResult } from './AdjustConfig.ts';
import type { AppsFlyerConfigResult } from './AppsFlyerConfig.ts';
import type { AttributionProvider } from './AttributionProvider.ts';
import { selectAttributionProvider, type AttributionProviderFactories } from './AttributionService.ts';

const enabledAppsFlyer: AppsFlyerConfigResult = {
  enabled: true,
  config: {
    devKey: 'fZvuk792H9hJQKmaTwuXxA',
    appleAppId: '6793860059',
    debugLogging: false,
    attWaitSeconds: 60,
  },
};

const disabledAppsFlyer: AppsFlyerConfigResult = {
  enabled: false,
  reason: 'VITE_APPSFLYER_ENABLED is not true',
  missingKeys: [],
};

const enabledAdjust: AdjustConfigResult = {
  enabled: true,
  config: {
    appToken: 'abcdefghijkl',
    environment: 'sandbox',
    verboseLogging: false,
    eventTokens: {
      appOpen: null,
      levelStart: null,
      levelComplete: null,
      levelFailed: null,
      rewardedWatched: null,
    },
    privacy: {
      disableIdfaReading: true,
      disableAppTrackingTransparencyUsage: true,
    },
  },
};

const disabledAdjust: AdjustConfigResult = {
  enabled: false,
  reason: 'VITE_ADJUST_IOS_ENABLED is not true',
  missingKeys: [],
};

function makeProvider(name: string): AttributionProvider {
  return {
    providerName: name,
    init: vi.fn(async (): Promise<void> => {}),
    track: vi.fn(async (): Promise<void> => {}),
  };
}

function makeFactories(): AttributionProviderFactories & { reasons: string[] } {
  const reasons: string[] = [];
  return {
    reasons,
    createAdjustProvider: vi.fn((): AttributionProvider => makeProvider('adjust')),
    createAppsFlyerProvider: vi.fn((): AttributionProvider => makeProvider('appsflyer')),
    createDisabledProvider: vi.fn((reason: string): AttributionProvider => {
      reasons.push(reason);
      return makeProvider('disabled');
    }),
  };
}

describe('selectAttributionProvider', (): void => {
  it('picks AppsFlyer when configured and no preference is set', (): void => {
    const factories = makeFactories();
    const provider = selectAttributionProvider({
      platform: 'ios',
      appsFlyerConfig: enabledAppsFlyer,
      adjustConfig: enabledAdjust,
      factories,
    });

    expect(provider.providerName).toBe('appsflyer');
    expect(factories.createAdjustProvider).not.toHaveBeenCalled();
  });

  it('falls back to Adjust on iOS when AppsFlyer is not configured', (): void => {
    const factories = makeFactories();
    const provider = selectAttributionProvider({
      platform: 'ios',
      appsFlyerConfig: disabledAppsFlyer,
      adjustConfig: enabledAdjust,
      factories,
    });

    expect(provider.providerName).toBe('adjust');
  });

  it('resolves disabled with a combined reason when nothing is configured', (): void => {
    const factories = makeFactories();
    const provider = selectAttributionProvider({
      platform: 'android',
      appsFlyerConfig: disabledAppsFlyer,
      adjustConfig: enabledAdjust,
      factories,
    });

    expect(provider.providerName).toBe('disabled');
    expect(factories.reasons[0]).toContain('AppsFlyer: VITE_APPSFLYER_ENABLED is not true');
    expect(factories.reasons[0]).toContain('Adjust: enabled but platform is android');
  });

  it('honors an explicit appsflyer preference, degrading to disabled when unconfigured', (): void => {
    const factories = makeFactories();
    const enabled = selectAttributionProvider({
      platform: 'android',
      preferred: 'appsflyer',
      appsFlyerConfig: enabledAppsFlyer,
      adjustConfig: enabledAdjust,
      factories,
    });
    const degraded = selectAttributionProvider({
      platform: 'android',
      preferred: 'appsflyer',
      appsFlyerConfig: disabledAppsFlyer,
      adjustConfig: enabledAdjust,
      factories,
    });

    expect(enabled.providerName).toBe('appsflyer');
    expect(degraded.providerName).toBe('disabled');
    expect(factories.reasons[0]).toContain('AppsFlyer unavailable');
  });

  it('honors an explicit adjust preference via the existing iOS-only rule', (): void => {
    const factories = makeFactories();
    const ios = selectAttributionProvider({
      platform: 'ios',
      preferred: 'adjust',
      appsFlyerConfig: enabledAppsFlyer,
      adjustConfig: enabledAdjust,
      factories,
    });
    const android = selectAttributionProvider({
      platform: 'android',
      preferred: 'adjust',
      appsFlyerConfig: enabledAppsFlyer,
      adjustConfig: enabledAdjust,
      factories,
    });

    expect(ios.providerName).toBe('adjust');
    expect(android.providerName).toBe('disabled');
  });

  it('honors an explicit disabled preference over configured providers', (): void => {
    const factories = makeFactories();
    const provider = selectAttributionProvider({
      platform: 'ios',
      preferred: 'disabled',
      appsFlyerConfig: enabledAppsFlyer,
      adjustConfig: enabledAdjust,
      factories,
    });

    expect(provider.providerName).toBe('disabled');
    expect(factories.reasons[0]).toBe('attribution disabled by explicit configuration');
  });

  it('reports the Adjust reason when neither provider is usable', (): void => {
    const factories = makeFactories();
    selectAttributionProvider({
      platform: 'ios',
      appsFlyerConfig: disabledAppsFlyer,
      adjustConfig: disabledAdjust,
      factories,
    });

    expect(factories.reasons[0]).toContain('Adjust: VITE_ADJUST_IOS_ENABLED is not true');
  });
});
