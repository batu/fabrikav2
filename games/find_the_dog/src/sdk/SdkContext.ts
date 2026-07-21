import { Capacitor } from '@capacitor/core';
import {
  resolveSdkEnvironments,
  type SdkBuildEnv,
  type SdkEnvironments,
} from '@fabrikav2/sdk';
import {
  AppLovinMaxProvider,
  createAdProvider,
  defaultAdProviderFactories,
  type AdProvider as SdkAdProvider,
  type AdProviderFactories,
  type AppLovinConfigResult as SdkAppLovinConfigResult,
} from '@fabrikav2/sdk/ads';
import {
  createAnalytics,
  createConsoleSink,
  createFirebaseSink,
  createOwnedMirrorSink,
  createRingBufferSink,
  type Analytics,
  type AnalyticsSink,
  type FirebaseTransport,
  type MirrorTransport,
  type OwnedMirrorSink,
  type RingBufferSink,
} from '@fabrikav2/sdk/analytics';
import {
  FakePurchaseProvider,
  RevenueCatProvider,
  type PurchaseProvider,
  type RevenueCatPurchasesPlugin,
} from '@fabrikav2/sdk/iap';
import {
  AttributionService as SdkAttributionService,
  createAttributionProvider,
} from '@fabrikav2/sdk/attribution';
import { setMusicPausedForAd } from '../audio/AudioManager';
import { gameState } from '../core/GameState';
import { readAppLovinConfigForPlatform } from '../ads/AppLovinConfig';
import { configureAdService } from '../ads/Service';
import {
  analytics,
  buildStamp,
  createFtdSessionId,
  type FtdEvent,
  type OwnedAnalyticsMirrorStats,
} from '../analytics/AnalyticsService';
import { createGameAnalyticsSink, type GameAnalyticsSdkLoader } from '../analytics/GameAnalyticsSink';
import { readGameAnalyticsIosConfig } from '../analytics/GameAnalyticsConfig';
import { readOwnedAnalyticsMirrorConfig } from '../analytics/OwnedAnalyticsMirrorConfig';
import {
  attribution,
  configureAttributionService,
} from '../attribution/AttributionService';
import { readAdjustIosConfig } from '../attribution/AdjustConfig';
import {
  createFtdRemoteConfigService,
  configureRemoteConfigService,
  type RemoteConfigService,
} from '../config/RemoteConfigService';
import { createFirebaseRemoteConfigProvider } from '../config/FirebaseRemoteConfigProvider';
import {
  ftdCatalogProduct,
  ftdDefaultStoreProduct,
  iapService,
  type FindTheDogIapComposition,
} from '../shop/IapService';
import { buildShopCatalog } from '../shop/ProductCatalog';

type Env = Record<string, string | boolean | undefined>;
type FirebaseAnalyticsLoader = () => Promise<{
  FirebaseAnalytics: {
    logEvent(options: { name: string; params: Record<string, string | number> }): Promise<void>;
  };
}>;
type RevenueCatLoader = () => Promise<unknown>;

export interface SdkProviderSelection {
  readonly platform: 'android' | 'ios' | 'web';
  readonly analyticsSinks: readonly string[];
  readonly iap: 'fake' | 'revenuecat';
  readonly ads: string;
  readonly attribution: string;
  readonly remoteConfig: 'static' | 'firebase';
}

export interface GameSdkContext {
  readonly environments: SdkEnvironments;
  readonly analytics: Analytics<FtdEvent>;
  readonly analyticsRing: RingBufferSink;
  readonly ads: SdkAdProvider;
  readonly attribution: SdkAttributionService;
  readonly iapComposition: FindTheDogIapComposition;
  readonly remoteConfig: RemoteConfigService;
  readonly selection: SdkProviderSelection;
  readonly ownedMirrorStats: () => OwnedAnalyticsMirrorStats;
}

export interface CreateSdkContextDependencies {
  readonly buildEnv?: SdkBuildEnv;
  readonly platform?: string;
  readonly isNativePlatform?: boolean;
  readonly env?: Env;
  readonly resolveEnvironments?: (buildEnv: SdkBuildEnv) => SdkEnvironments;
  readonly firebaseAnalyticsLoader?: FirebaseAnalyticsLoader;
  readonly revenueCatLoader?: RevenueCatLoader;
  readonly gameAnalyticsLoader?: GameAnalyticsSdkLoader;
  readonly mirrorTransport?: MirrorTransport;
  readonly adProviderFactories?: AdProviderFactories;
  readonly logger?: Pick<Console, 'warn'>;
}

/** Pure synchronous composition function. Native modules remain behind lazy
 * transports/proxies, so web and CI never import them. */
export function createSdkContext(deps: CreateSdkContextDependencies = {}): GameSdkContext {
  const env = deps.env ?? import.meta.env;
  const buildEnv = deps.buildEnv ?? (import.meta.env.PROD ? 'production' : 'development');
  const environments = (deps.resolveEnvironments ?? resolveSdkEnvironments)(buildEnv);
  const platform = normalizePlatform(deps.platform ?? Capacitor.getPlatform());
  const isNativePlatform = deps.isNativePlatform ?? Capacitor.isNativePlatform();
  const logger = deps.logger ?? console;

  let analyticsFacade: Analytics<FtdEvent> | null = null;
  const appLovinConfig: SdkAppLovinConfigResult = readAppLovinConfigForPlatform(
    platform === 'ios' ? 'ios' : 'android',
    env,
  );
  const lifecycle = {
    onFullScreenAdStarted: (): void => setMusicPausedForAd(true),
    onFullScreenAdFinished: (): void => setMusicPausedForAd(false),
  };
  const baseFactories = deps.adProviderFactories;
  const adFactories: AdProviderFactories | undefined = baseFactories === undefined
    ? {
        createAdMobProvider: () => {
          throw new Error('FTD does not compose AdMob');
        },
        createAppLovinMaxProvider: (config) => new AppLovinMaxProvider(config, {
          lifecycle,
          onAdRevenuePaid: (event): void => {
            analyticsFacade?.track('ad_revenue_paid', { ...event });
          },
        }),
        createDisabledProvider: defaultAdProviderFactories.createDisabledProvider,
      }
    : baseFactories;
  const ads = createAdProvider(platform, appLovinConfig, adFactories, lifecycle);

  const adjustConfig = readAdjustIosConfig(env, buildEnv === 'production');
  const resolvedAdjustConfig = adjustConfig.enabled
    ? { ...adjustConfig, config: { ...adjustConfig.config, environment: environments.adjust } }
    : adjustConfig;
  const attributionProvider = createAttributionProvider(platform, resolvedAdjustConfig);
  const attributionService = new SdkAttributionService(attributionProvider);

  const sinks: AnalyticsSink[] = [];
  if (buildEnv === 'development') sinks.push(createConsoleSink());
  const ring = createRingBufferSink();
  sinks.push(ring);

  // Native Firebase (@capacitor-firebase/analytics) aborts at +[FIRApp configure]
  // when the build ships no Firebase config. Mirror V1 firebaseOptions(): only
  // construct the sink on native iOS when API_KEY+PROJECT_ID+APP_ID are all present.
  if (platform === 'ios' && isNativePlatform && firebaseConfigPresent(env)) {
    sinks.push(createFirebaseSink(createLazyFirebaseTransport(
      deps.firebaseAnalyticsLoader ?? (() => import('@capacitor-firebase/analytics')),
    )));
  }

  let ownedMirror: OwnedMirrorSink | null = null;
  let ownedMirrorDisabledReason = 'owned analytics mirror is not configured';
  const mirrorConfig = readOwnedAnalyticsMirrorConfig(env);
  if (mirrorConfig.config.enabled && mirrorConfig.config.endpointUrl !== null && mirrorConfig.config.publicClientKey !== null) {
    ownedMirror = createOwnedMirrorSink({
      url: mirrorConfig.config.endpointUrl,
      publicClientKey: mirrorConfig.config.publicClientKey,
      transport: deps.mirrorTransport ?? fetchMirrorTransport,
      gameId: 'find_the_dog',
      env: environments.analytics,
      batchSize: mirrorConfig.config.flushBatchSize,
      maxAttempts: mirrorConfig.config.maxAttempts,
    });
    sinks.push(ownedMirror);
    ownedMirrorDisabledReason = '';
  } else {
    ownedMirrorDisabledReason = mirrorConfig.config.disabledReason ?? 'owned analytics mirror is invalid';
  }

  const gaConfig = readGameAnalyticsIosConfig(env, buildEnv === 'production');
  if (platform === 'ios' && gaConfig.enabled) {
    sinks.push(createGameAnalyticsSink(gaConfig.config, { loader: deps.gameAnalyticsLoader, logger }));
  }

  analyticsFacade = createAnalytics<FtdEvent>({
    env: environments.analytics,
    sessionId: createFtdSessionId(),
    sinks,
    globalParams: { game: 'find_the_dog', platform, build: buildStamp() },
  });

  const catalogProducts = () => buildShopCatalog().products.map(ftdCatalogProduct);
  const revenueCatKey = envString(env.VITE_REVENUECAT_IOS_API_KEY);
  let purchaseProvider: PurchaseProvider;
  let iapSelection: SdkProviderSelection['iap'] = 'fake';
  if (platform === 'ios' && isNativePlatform && revenueCatKey !== null) {
    purchaseProvider = new RevenueCatProvider({
      plugin: createLazyRevenueCatPlugin(deps.revenueCatLoader ?? (() => import('@revenuecat/purchases-capacitor'))),
      catalogProducts,
    });
    iapSelection = 'revenuecat';
  } else {
    if (platform === 'ios' && isNativePlatform && revenueCatKey === null) {
      logger.warn('[iap] RELEASE BLOCKER: native iOS is using FakePurchaseProvider because VITE_REVENUECAT_IOS_API_KEY is absent');
    }
    purchaseProvider = new FakePurchaseProvider({
      products: buildShopCatalog().products.map(ftdDefaultStoreProduct),
    });
  }
  const apiKey = revenueCatKey ?? 'test_find_the_dog_sandbox';
  const iapComposition: FindTheDogIapComposition = {
    // Preserve the current seeded fake web service as ready while still selecting
    // the provider from the real production matrix.
    isNativePlatform: () => iapSelection === 'fake' ? true : isNativePlatform,
    platform: () => iapSelection === 'fake' ? 'ios' : platform,
    apiKey: () => apiKey,
    provider: () => purchaseProvider,
  };

  const firebaseRemoteProvider = platform === 'ios' && isNativePlatform
    ? createFirebaseRemoteConfigProvider()
    : undefined;
  const remoteConfig = createFtdRemoteConfigService(firebaseRemoteProvider, firebaseRemoteProvider);

  const ownedMirrorStats = (): OwnedAnalyticsMirrorStats => {
    if (ownedMirror === null) {
      return { queued: 0, dropped: 0, sent: 0, failed: 0, disabledReason: ownedMirrorDisabledReason };
    }
    const stats = ownedMirror.stats();
    return {
      queued: stats.queueLength,
      dropped: stats.dropped,
      sent: stats.sent,
      failed: stats.retried,
      disabledReason: null,
    };
  };

  return {
    environments,
    analytics: analyticsFacade,
    analyticsRing: ring,
    ads,
    attribution: attributionService,
    iapComposition,
    remoteConfig,
    selection: {
      platform,
      analyticsSinks: sinks.map((sink) => sink.name),
      iap: iapSelection,
      ads: ads.providerName,
      attribution: attributionProvider.providerName,
      remoteConfig: firebaseRemoteProvider === undefined ? 'static' : 'firebase',
    },
    ownedMirrorStats,
  };
}

let installedContext: GameSdkContext | null = null;

export function installSdkContext(context: GameSdkContext): GameSdkContext {
  installedContext = context;
  configureAdService(context.ads);
  configureAttributionService(context.attribution);
  configureRemoteConfigService(context.remoteConfig);
  iapService.configureComposition(context.iapComposition);
  analytics.configureComposition({
    sdk: context.analytics,
    attribution,
    providerName: () => context.ads.providerName,
    ownedMirrorStats: context.ownedMirrorStats,
  });
  // Drain any achievement analytics recovered from a prior session's outbox now
  // that the real sinks are composed (load() never dispatches — KTD6/correction 1).
  gameState.drainAnalyticsOutbox();
  return context;
}

export function getSdkContext(): GameSdkContext {
  return installedContext ?? installSdkContext(createSdkContext());
}

function normalizePlatform(value: string): 'android' | 'ios' | 'web' {
  return value === 'ios' || value === 'android' ? value : 'web';
}

/** Mirrors V1 firebaseOptions() completeness: the native Firebase SDK requires
 * API_KEY, PROJECT_ID, and APP_ID to configure. Absent any of them, the app must
 * make zero native Firebase touches. */
function firebaseConfigPresent(env: Env): boolean {
  return envString(env.VITE_FIREBASE_API_KEY) !== null
    && envString(env.VITE_FIREBASE_PROJECT_ID) !== null
    && envString(env.VITE_FIREBASE_APP_ID) !== null;
}

function envString(value: string | boolean | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function createLazyFirebaseTransport(loader: FirebaseAnalyticsLoader): FirebaseTransport {
  let load: ReturnType<FirebaseAnalyticsLoader> | null = null;
  return {
    async logEvent(name, params): Promise<void> {
      load ??= loader();
      const { FirebaseAnalytics } = await load;
      await FirebaseAnalytics.logEvent({ name, params: { ...params } });
    },
  };
}

async function fetchMirrorTransport(request: Parameters<MirrorTransport>[0]): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${request.publicClientKey}`,
      'content-type': 'application/json',
    },
    body: request.body,
  });
  return { ok: response.ok, status: response.status };
}

function createLazyRevenueCatPlugin(loader: RevenueCatLoader): RevenueCatPurchasesPlugin {
  let loaded: Promise<RevenueCatPurchasesPlugin> | null = null;
  const get = (): Promise<RevenueCatPurchasesPlugin> => {
    loaded ??= loader().then(adaptRevenueCatModule);
    return loaded;
  };
  return {
    configure: async (options) => (await get()).configure(options),
    getProducts: async (options) => (await get()).getProducts(options),
    getOfferings: async () => (await get()).getOfferings(),
    purchaseStoreProduct: async (options) => (await get()).purchaseStoreProduct(options),
    restorePurchases: async () => (await get()).restorePurchases(),
    addCustomerInfoUpdateListener: async (listener) => (await get()).addCustomerInfoUpdateListener(listener),
    removeCustomerInfoUpdateListener: async (listener) => (await get()).removeCustomerInfoUpdateListener(listener),
  };
}

function adaptRevenueCatModule(module: unknown): RevenueCatPurchasesPlugin {
  const record = module as { Purchases?: Record<string, (...args: never[]) => Promise<unknown>> };
  const purchases = record.Purchases;
  if (purchases === undefined) throw new Error('RevenueCat module did not expose Purchases');
  const listenerIds = new Map<Parameters<RevenueCatPurchasesPlugin['addCustomerInfoUpdateListener']>[0], string>();
  return {
    configure: (options) => purchases.configure(options as never) as Promise<void>,
    getProducts: (options) => purchases.getProducts(options as never) as ReturnType<RevenueCatPurchasesPlugin['getProducts']>,
    getOfferings: () => purchases.getOfferings() as ReturnType<RevenueCatPurchasesPlugin['getOfferings']>,
    purchaseStoreProduct: (options) => purchases.purchaseStoreProduct(options as never) as ReturnType<RevenueCatPurchasesPlugin['purchaseStoreProduct']>,
    restorePurchases: () => purchases.restorePurchases() as ReturnType<RevenueCatPurchasesPlugin['restorePurchases']>,
    async addCustomerInfoUpdateListener(listener): Promise<void> {
      const id = await purchases.addCustomerInfoUpdateListener(listener as never) as string;
      listenerIds.set(listener, id);
    },
    async removeCustomerInfoUpdateListener(listener): Promise<void> {
      const id = listenerIds.get(listener);
      if (id === undefined) return;
      listenerIds.delete(listener);
      await purchases.removeCustomerInfoUpdateListener({ listenerToRemove: id } as never);
    },
  };
}
