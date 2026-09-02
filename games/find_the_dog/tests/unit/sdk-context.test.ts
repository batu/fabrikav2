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

  it('selects configured native iOS adapters including AdMob', () => {
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
        VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_dog',
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
        VITE_FTD_DISABLE_REMOTE_CONFIG: 'false',
      },
      firebaseAnalyticsLoader: firebase,
      revenueCatLoader: revenuecat,
      gameAnalyticsLoader: gameanalytics,
      gameAnalyticsIdentityPolicy: { approvedGameKeys: ['a'.repeat(32)] },
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

  it('uses static defaults when native Remote Config is explicitly disabled', () => {
    const context = createSdkContext({
      buildEnv: 'production',
      platform: 'ios',
      isNativePlatform: true,
      env: {
        VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
        VITE_FIREBASE_API_KEY: 'firebase-api-key',
        VITE_FIREBASE_PROJECT_ID: 'firebase-project-id',
        VITE_FIREBASE_APP_ID: 'firebase-app-id',
        VITE_FTD_DISABLE_REMOTE_CONFIG: 'true',
      },
    });

    expect(context.selection.remoteConfig).toBe('static');
    expect(context.remoteConfig.snapshot().state).toBe('local-only');
  });

  it('fails closed instead of falling back to sample IDs when AdMob config is incomplete', () => {
    const context = createSdkContext({
      buildEnv: 'production',
      platform: 'ios',
      isNativePlatform: true,
      env: {
        VITE_ADMOB_IOS_ENABLED: 'true',
        VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      },
    });
    expect(context.selection.ads).toBe('disabled');
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

  it('stamps every event with the runtime game identity fields', () => {
    vi.stubGlobal('__BUILD_INFO__', { version: '1.0.4', sha: 'abc123', dirty: false });
    const context = createSdkContext({ buildEnv: 'development', platform: 'ios', env: {} });

    context.analytics.track('dog_found', { cohort_bucket: 3 });

    expect(context.analyticsRing.drain()[0]?.params).toMatchObject({
      game: 'find_the_dog',
      platform: 'ios',
      app_version: expect.any(String),
      build: expect.any(String),
      cohort_bucket: 3,
    });
  });

  it('selects strict AppsFlyer from the shared config matrix', () => {
    const context = createSdkContext({
      buildEnv: 'production', platform: 'ios', isNativePlatform: true,
      env: {
        VITE_ATTRIBUTION_PROVIDER: 'appsflyer', VITE_APPSFLYER_ENABLED: 'true',
        VITE_APPSFLYER_DEV_KEY: 'owner-key-for-test', VITE_APPSFLYER_APPLE_APP_ID: '6772100729',
        VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
      },
    });
    expect(context.selection.attribution).toBe('appsflyer');
    expect(context.selection.analyticsSinks).not.toContain('firebase');
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

  it('fails production closed for an arbitrary HTTPS mirror unless the endpoint is explicitly approved for FTD', () => {
    const endpoint = 'https://analytics.example.com/ingest';
    const env = {
      VITE_FTD_OWNED_ANALYTICS_MIRROR_URL: endpoint,
      VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY: 'public_client_key_1234',
    };
    const rejected = createSdkContext({ buildEnv: 'production', platform: 'web', env });
    const testApproved = createSdkContext({
      buildEnv: 'production',
      platform: 'web',
      env,
      ownedMirrorIdentityPolicy: { approvedEndpointUrls: [endpoint] },
      mirrorTransport: vi.fn(async () => ({ ok: true, status: 200 })),
    });

    expect(rejected.selection.analyticsSinks).not.toContain('owned-mirror');
    expect(rejected.ownedMirrorStats().disabledReason).toContain('not approved for find_the_dog');
    expect(testApproved.selection.analyticsSinks).toContain('owned-mirror');
  });

  it('exposes only non-secret runtime analytics diagnostics', () => {
    const secretCanary = 'public_client_key_secret_canary';
    const context = createSdkContext({
      buildEnv: 'development',
      platform: 'web',
      env: {
        VITE_FTD_OWNED_ANALYTICS_MIRROR_URL: 'https://analytics.example.com/ingest',
        VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY: secretCanary,
      },
      mirrorTransport: vi.fn(async () => ({ ok: true, status: 200 })),
    });

    const diagnostics = context.analyticsDiagnostics();

    expect(diagnostics).toMatchObject({
      game: 'find_the_dog',
      environment: 'development',
      platform: 'web',
      selectedSinks: ['console', 'ring-buffer', 'owned-mirror'],
      providers: {
        attribution: 'disabled',
        ads: 'disabled',
        iap: 'fake',
        remoteConfig: 'static',
      },
    });
    expect(diagnostics.sinks['owned-mirror']).toMatchObject({
      queued: 0,
      sent: 0,
      retried: 0,
      dropped: 0,
    });
    expect(diagnostics.sinks['ring-buffer']).toMatchObject({
      queued: 0,
      sent: 0,
      dropped: 0,
    });
    expect(diagnostics.sinks).not.toHaveProperty('console');
    expect(JSON.stringify(diagnostics)).not.toContain(secretCanary);
    expect(JSON.stringify(diagnostics)).not.toContain('analytics.example.com');
  });

  it('reports truthful ring-buffer metrics after emission', () => {
    const context = createSdkContext({ buildEnv: 'development', platform: 'web', env: {} });

    context.analytics.track('dog_found', { level_id: 'level_1', dog_index: 0 });

    expect(context.analyticsDiagnostics().sinks['ring-buffer']).toMatchObject({
      queued: 1,
      sent: 1,
      dropped: 0,
    });
    expect(context.analyticsDiagnostics().sinks).not.toHaveProperty('console');
  });

  it('keeps GameAnalytics initialization failure non-crashing and observable', async () => {
    const context = createSdkContext({
      buildEnv: 'production',
      platform: 'ios',
      isNativePlatform: true,
      env: {
        VITE_REVENUECAT_IOS_API_KEY: 'appl_A1b2C3d4E5f6G7h8I9j0K1l2M3n',
        VITE_GAMEANALYTICS_IOS_ENABLED: 'true',
        VITE_GAMEANALYTICS_IOS_GAME_ID: 'find_the_dog',
        VITE_GAMEANALYTICS_IOS_GAME_KEY: 'a'.repeat(32),
        VITE_GAMEANALYTICS_IOS_SECRET_KEY: 'b'.repeat(40),
        VITE_FTD_DISABLE_REMOTE_CONFIG: 'true',
      },
      gameAnalyticsLoader: vi.fn(async () => { throw new TypeError('secret-canary'); }),
      gameAnalyticsIdentityPolicy: { approvedGameKeys: ['a'.repeat(32)] },
      logger: { warn: vi.fn() },
    });

    context.analytics.track('app_open');
    await expect(context.analytics.flush()).resolves.toBeUndefined();

    expect(context.analyticsDiagnostics().sinks.gameanalytics).toMatchObject({
      queued: 0,
      sent: 0,
      dropped: 1,
      initializationFailure: 'TypeError',
      lastSuccessfulFlushAt: null,
    });
    expect(JSON.stringify(context.analyticsDiagnostics())).not.toContain('secret-canary');
  });

  it('blocks sensitive identifiers from the owned mirror canonical allowlist', async () => {
    const bodies: string[] = [];
    const context = createSdkContext({
      buildEnv: 'development',
      platform: 'web',
      env: {
        VITE_FTD_OWNED_ANALYTICS_MIRROR_URL: 'https://analytics.example.com/ingest',
        VITE_FTD_OWNED_ANALYTICS_MIRROR_PUBLIC_CLIENT_KEY: 'public_client_key_1234',
      },
      mirrorTransport: vi.fn(async (request) => {
        bodies.push(request.body);
        return { ok: true, status: 200 };
      }),
    });

    context.analytics.track('purchase_fulfilled', {
      product_id: 'hints_pack',
      purchase_id: 'purchase-secret-123456',
      transaction_id: 'transaction-secret-123456',
      receipt: 'receipt-secret-123456',
    });
    context.analytics.track('app_background', { levels_played: 3 });
    await context.analytics.flush();

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('hints_pack');
    expect(bodies[0]).toContain('"levels_played":3');
    expect(bodies[0]).not.toContain('purchase-secret');
    expect(bodies[0]).not.toContain('transaction-secret');
    expect(bodies[0]).not.toContain('receipt-secret');
  });
});
