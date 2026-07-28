import { describe, expect, it, vi } from 'vitest';
import { createSdkContext } from '../../src/sdk/SdkContext';
import { gameConfig } from '../../game.config';

describe('FTD SdkContext composition matrix', () => {
  it('resolves environments once and keeps web/CI native loaders cold', () => {
    const resolve = vi.fn(() => ({
      analytics: 'development' as const,
      adjust: 'sandbox' as const,
      admobTestMode: true,
      revenuecatSandbox: true,
    }));
    const firebase = vi.fn();
    const revenuecat = vi.fn();
    const gameanalytics = vi.fn();

    const context = createSdkContext({
      buildEnv: 'development',
      platform: 'web',
      isNativePlatform: false,
      env: {},
      resolveEnvironments: resolve,
      firebaseAnalyticsLoader: firebase,
      revenueCatLoader: revenuecat,
      gameAnalyticsLoader: gameanalytics,
    });

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(context.environments.analytics).toBe('development');
    expect(context.environments.adjust).toBe('sandbox');
    expect(context.selection).toMatchObject({
      platform: 'web',
      iap: 'fake',
      ads: 'disabled',
      attribution: 'disabled',
      remoteConfig: 'static',
    });
    expect(context.selection.analyticsSinks).toEqual(['console', 'ring-buffer']);
    expect(firebase).not.toHaveBeenCalled();
    expect(revenuecat).not.toHaveBeenCalled();
    expect(gameanalytics).not.toHaveBeenCalled();
  });

  it('selects every configured native iOS adapter without eagerly loading plugins', () => {
    const firebase = vi.fn();
    const revenuecat = vi.fn();
    const gameanalytics = vi.fn();
    const context = createSdkContext({
      buildEnv: 'production',
      platform: 'ios',
      isNativePlatform: true,
      env: {
        PROD: true,
        VITE_REVENUECAT_IOS_API_KEY: 'appl_live_public_key',
        VITE_GAMEANALYTICS_IOS_GAME_KEY: 'g'.repeat(32),
        VITE_GAMEANALYTICS_IOS_SECRET_KEY: 's'.repeat(40),
        VITE_ADJUST_IOS_ENABLED: 'true',
        VITE_ADJUST_IOS_APP_TOKEN: 'a'.repeat(12),
        VITE_ADJUST_IOS_ENVIRONMENT: 'production',
        VITE_APPLOVIN_IOS_ENABLED: 'true',
        VITE_APPLOVIN_IOS_GENERAL_AUDIENCE_ONLY: 'true',
        VITE_APPLOVIN_IOS_SDK_KEY: 'public-applovin-sdk-key',
        VITE_FIREBASE_API_KEY: 'firebase-api-key',
        VITE_FIREBASE_PROJECT_ID: 'firebase-project-id',
        VITE_FIREBASE_APP_ID: 'firebase-app-id',
      },
      firebaseAnalyticsLoader: firebase,
      revenueCatLoader: revenuecat,
      gameAnalyticsLoader: gameanalytics,
    });

    expect(context.selection.iap).toBe('revenuecat');
    expect(context.selection.remoteConfig).toBe('firebase');
    expect(context.selection.ads).toBe('applovin-max');
    expect(context.selection.attribution).toBe('adjust-ios');
    expect(context.selection.analyticsSinks).toEqual([
      'ring-buffer',
      'firebase',
      'gameanalytics',
    ]);
    expect(context.environments.adjust).toBe('production');
    expect(firebase).not.toHaveBeenCalled();
    expect(revenuecat).not.toHaveBeenCalled();
    expect(gameanalytics).not.toHaveBeenCalled();
  });

  it('forwards iOS events through the lazy Firebase transport', async () => {
    const logEvent = vi.fn(async () => undefined);
    const loader = vi.fn(async () => ({ FirebaseAnalytics: { logEvent } }));
    const context = createSdkContext({
      buildEnv: 'development',
      platform: 'ios',
      isNativePlatform: true,
      env: {
        VITE_FIREBASE_API_KEY: 'firebase-api-key',
        VITE_FIREBASE_PROJECT_ID: 'firebase-project-id',
        VITE_FIREBASE_APP_ID: 'firebase-app-id',
      },
      firebaseAnalyticsLoader: loader,
    });

    expect(context.selection.analyticsSinks).toContain('firebase');
    context.analytics.track('dog_found', { dog_index: 0, no_ads: false });
    await vi.waitFor(() => expect(logEvent).toHaveBeenCalled());
    expect(loader).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'dog_found',
      params: expect.objectContaining({ dog_index: 0, no_ads: 'false' }),
    }));
  });

  it('omits the Firebase sink and never touches the plugin when config is absent on native iOS', async () => {
    const logEvent = vi.fn(async () => undefined);
    const loader = vi.fn(async () => ({ FirebaseAnalytics: { logEvent } }));
    const context = createSdkContext({
      buildEnv: 'development',
      platform: 'ios',
      isNativePlatform: true,
      env: {},
      firebaseAnalyticsLoader: loader,
    });

    expect(context.selection.analyticsSinks).not.toContain('firebase');
    // Even after emitting an event, the gated-out loader must never run — zero
    // native @capacitor-firebase plugin touches, so no +[FIRApp configure].
    context.analytics.track('dog_found', { dog_index: 0, no_ads: false });
    await Promise.resolve();
    expect(loader).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('omits the Firebase sink when config is partial (missing APP_ID)', () => {
    const loader = vi.fn(async () => ({ FirebaseAnalytics: { logEvent: vi.fn() } }));
    const context = createSdkContext({
      buildEnv: 'development',
      platform: 'ios',
      isNativePlatform: true,
      env: {
        VITE_FIREBASE_API_KEY: 'firebase-api-key',
        VITE_FIREBASE_PROJECT_ID: 'firebase-project-id',
      },
      firebaseAnalyticsLoader: loader,
    });

    expect(context.selection.analyticsSinks).not.toContain('firebase');
    expect(loader).not.toHaveBeenCalled();
  });

  it('omits the Firebase sink on non-native iOS even with complete config', () => {
    const loader = vi.fn(async () => ({ FirebaseAnalytics: { logEvent: vi.fn() } }));
    const context = createSdkContext({
      buildEnv: 'development',
      platform: 'ios',
      isNativePlatform: false,
      env: {
        VITE_FIREBASE_API_KEY: 'firebase-api-key',
        VITE_FIREBASE_PROJECT_ID: 'firebase-project-id',
        VITE_FIREBASE_APP_ID: 'firebase-app-id',
      },
      firebaseAnalyticsLoader: loader,
    });

    expect(context.selection.analyticsSinks).not.toContain('firebase');
    expect(loader).not.toHaveBeenCalled();
  });

  it('keeps every game.config analytics id emittable through the root facade', () => {
    const context = createSdkContext({ buildEnv: 'development', platform: 'web', env: {} });
    for (const eventName of gameConfig.analyticsEvents) context.analytics.track(eventName);
    expect(context.analyticsRing.drain().map((event) => event.name)).toEqual(gameConfig.analyticsEvents);
  });

  it('enables the owned mirror only when URL and public key are both valid', () => {
    const enabled = createSdkContext({
      buildEnv: 'development',
      platform: 'web',
      env: {
        VITE_FTD_OWNED_ANALYTICS_MIRROR_URL: 'https://analytics.example.com/ingest',
        VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY: 'public_client_key_1234',
      },
      mirrorTransport: vi.fn(async () => ({ ok: true, status: 200 })),
    });
    const missingKey = createSdkContext({
      buildEnv: 'development',
      platform: 'web',
      env: { VITE_FTD_OWNED_ANALYTICS_MIRROR_URL: 'https://analytics.example.com/ingest' },
    });

    expect(enabled.selection.analyticsSinks).toContain('owned-mirror');
    expect(enabled.ownedMirrorStats().disabledReason).toBeNull();
    expect(missingKey.selection.analyticsSinks).not.toContain('owned-mirror');
    expect(missingKey.ownedMirrorStats().disabledReason).toContain('missing');
  });
});
