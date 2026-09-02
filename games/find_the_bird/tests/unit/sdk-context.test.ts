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
        VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
        VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
        VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_bird',
        VITE_GAMEANALYTICS_IOS_GAME_KEY: 'a'.repeat(32),
        VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
        VITE_ADJUST_IOS_ENABLED: 'true',
        VITE_ADJUST_IOS_APP_TOKEN: 'a'.repeat(12),
        VITE_ADJUST_IOS_ENVIRONMENT: 'production',
        VITE_ADMOB_IOS_ENABLED: 'true',
        VITE_ADMOB_IOS_APP_ID: 'ca-app-pub-1234567890123456~1234567890',
        VITE_ADMOB_IOS_BANNER_ID: 'ca-app-pub-1234567890123456/1111111111',
        VITE_ADMOB_IOS_INTERSTITIAL_ID: 'ca-app-pub-1234567890123456/2222222222',
        VITE_ADMOB_IOS_REWARDED_ID: 'ca-app-pub-1234567890123456/3333333333',
        VITE_ADMOB_IOS_TEST_MODE: 'false',
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
    expect(context.selection.ads).toBe('admob');
    expect(context.selection.attribution).toBe('adjust-ios');
    expect(context.selection.analyticsSinks).toEqual(['ring-buffer', 'gameanalytics']);
    expect(context.environments.adjust).toBe('production');
    expect(firebase).not.toHaveBeenCalled();
    expect(revenuecat).not.toHaveBeenCalled();
    expect(gameanalytics).not.toHaveBeenCalled();
  });

  it('fails closed instead of falling back when an environment override is malformed', () => {
    const context = createSdkContext({
      buildEnv: 'production',
      platform: 'ios',
      isNativePlatform: true,
      env: {
        VITE_ADMOB_IOS_ENABLED: 'true',
        VITE_ADMOB_IOS_BANNER_ID: 'not-an-ad-unit-id',
        VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      },
    });
    expect(context.selection.ads).toBe('disabled');
  });

  it('fails closed on native Android when Android AdMob config is absent', () => {
    const context = createSdkContext({
      buildEnv: 'development',
      platform: 'android',
      isNativePlatform: true,
      env: {},
    });

    expect(context.selection.ads).toBe('disabled');
    expect(context.ads.providerName).toBe('disabled');
  });

  it('keeps Firebase Analytics absent even with complete Firebase config', async () => {
    const loader = vi.fn();
    const context = createSdkContext({ buildEnv: 'development', platform: 'ios', isNativePlatform: true, env: { VITE_FIREBASE_API_KEY: 'configured', VITE_FIREBASE_PROJECT_ID: 'configured', VITE_FIREBASE_APP_ID: 'configured' }, firebaseAnalyticsLoader: loader });
    expect(context.selection.analyticsSinks).not.toContain('firebase');
    context.analytics.track('dog_found', { dog_index: 0, no_ads: false });
    await Promise.resolve();
    expect(loader).not.toHaveBeenCalled();
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

  it('honors explicit ad and attribution choices and rejects provider typos', () => {
    const context = createSdkContext({
      buildEnv: 'production',
      platform: 'ios',
      isNativePlatform: true,
      env: {
        VITE_AD_PROVIDER: 'admob',
        VITE_ADMOB_IOS_ENABLED: 'true',
        VITE_ADMOB_IOS_APP_ID: 'ca-app-pub-1234567890123456~1234567890',
        VITE_ADMOB_IOS_BANNER_ID: 'ca-app-pub-1234567890123456/1111111111',
        VITE_ADMOB_IOS_INTERSTITIAL_ID: 'ca-app-pub-1234567890123456/2222222222',
        VITE_ADMOB_IOS_REWARDED_ID: 'ca-app-pub-1234567890123456/3333333333',
        VITE_ATTRIBUTION_PROVIDER: 'disabled',
        VITE_ADJUST_IOS_ENABLED: 'true',
        VITE_ADJUST_IOS_APP_TOKEN: 'a'.repeat(12),
        VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      },
    });

    expect(context.selection.ads).toBe('admob');
    expect(context.selection.attribution).toBe('disabled');
    expect(() => createSdkContext({
      buildEnv: 'production',
      platform: 'ios',
      env: { VITE_ATTRIBUTION_PROVIDER: 'adjusted' },
    })).toThrow('Invalid configuration choice');
  });

  it('uses the bird identity in analytics events and owned mirror batches', async () => {
    const mirrorTransport = vi.fn(async (_request: { body: string }) => ({ ok: true, status: 200 }));
    const context = createSdkContext({
      buildEnv: 'development',
      platform: 'web',
      env: {
        VITE_FTD_OWNED_ANALYTICS_MIRROR_URL: 'https://analytics.example.com/ingest',
        VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY: 'public_client_key_1234',
      },
      mirrorTransport,
      storage: {
        durability: 'durable',
        getItem: () => null,
        setItem: () => {},
      },
    });

    context.analytics.track('app_open');
    expect(context.analyticsRing.drain()[0]?.params.game).toBe('find_the_bird');
    await context.analytics.flush();
    const request = mirrorTransport.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    expect(JSON.parse(request!.body).game_id).toBe('find_the_bird');
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
  it('selects Base Game Lab AdMob for configured native Android', () => {
    const context = createSdkContext({
      buildEnv: 'production', platform: 'android', isNativePlatform: true,
      env: {
        VITE_REVENUECAT_ANDROID_API_KEY: `goog_${'a'.repeat(28)}`,
        VITE_ADMOB_ANDROID_ENABLED: 'true',
        VITE_ADMOB_ANDROID_APP_ID: 'ca-app-pub-1234567890123456~4444444444',
        VITE_ADMOB_ANDROID_BANNER_ID: 'ca-app-pub-1234567890123456/5555555555',
        VITE_ADMOB_ANDROID_INTERSTITIAL_ID: 'ca-app-pub-1234567890123456/6666666666',
        VITE_ADMOB_ANDROID_REWARDED_ID: 'ca-app-pub-1234567890123456/7777777777',
      },
    });
    expect(context.selection.ads).toBe('admob');
  });

  it('reports GameAnalytics selection reason and safe runtime provenance', () => {
    vi.stubGlobal('__BUILD_INFO__', { version: '1.2.0', sha: 'abc123', dirty: false });
    const disabled = createSdkContext({ buildEnv: 'development', platform: 'ios', env: {} });
    const enabled = createSdkContext({
      buildEnv: 'development',
      platform: 'ios',
      env: {
        VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
        VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_bird',
        VITE_GAMEANALYTICS_IOS_GAME_KEY: 'a'.repeat(32),
        VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
      },
      gameAnalyticsLoader: vi.fn(async () => ({
        GameAnalytics: {
          setEnabledInfoLog: vi.fn(), setEnabledVerboseLog: vi.fn(),
          configureAvailableResourceCurrencies: vi.fn(), configureAvailableResourceItemTypes: vi.fn(),
          initialize: vi.fn(), isSdkReady: vi.fn(() => true),
          addProgressionEvent: vi.fn(), addDesignEvent: vi.fn(),
          addResourceEvent: vi.fn(), addAdEvent: vi.fn(),
        },
        EGAProgressionStatus: { Start: 1, Complete: 2, Fail: 3 },
        EGAResourceFlowType: { Source: 1, Sink: 2 },
        EGAAdAction: { Show: 1, FailedShow: 2, RewardReceived: 3 },
        EGAAdType: { Banner: 1, Interstitial: 2, RewardedVideo: 3 },
      })),
    });

    enabled.analytics.track('dog_found');
    expect(enabled.analyticsRing.drain()[0]?.params).toMatchObject({
      game: 'find_the_bird',
      platform: 'ios',
      build: expect.any(String),
      app_version: '1.2.0',
      environment: 'development',
    });
    expect(disabled.analyticsDiagnostics().gameAnalytics).toEqual({
      enabled: false,
      reason: 'GameAnalytics iOS is disabled',
    });
    expect(enabled.analyticsDiagnostics()).toMatchObject({
      game: 'find_the_bird',
      environment: 'development',
      platform: 'ios',
      selectedSinks: expect.arrayContaining(['ring-buffer', 'gameanalytics']),
      gameAnalytics: { enabled: true, reason: null },
    });
  });
});
