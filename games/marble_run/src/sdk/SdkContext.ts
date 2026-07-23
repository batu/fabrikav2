import { Capacitor } from '@capacitor/core';
import {
  AppLovinMaxProvider,
  createAdProvider,
  defaultAdProviderFactories,
  readAppLovinConfigForPlatform,
  type AdProvider,
  type AdProviderFactories,
  type AppLovinConfigResult,
} from '@fabrikav2/sdk/ads';
import {
  createFirebaseSink,
  type AnalyticsSink,
  type FirebaseTransport,
} from '@fabrikav2/sdk/analytics';
import {
  createMetaProvider,
  readMetaConfig,
  type MetaConfigResult,
  type MetaProvider,
} from '@fabrikav2/sdk/meta';
import type { AttributionProvider } from '@fabrikav2/sdk/attribution';
import { setMusicPausedForAd } from '../audio/AudioManager';
import { configureAdService } from '../ads/Service';
import { analytics } from '../analytics/AnalyticsService';
import {
  attribution,
  createMarbleRunAttributionProvider,
} from '../attribution/AttributionService';

type Env = Record<string, string | boolean | undefined>;
type FirebaseAnalyticsLoader = () => Promise<{
  FirebaseAnalytics: {
    logEvent(options: { name: string; params: Record<string, string | number> }): Promise<void>;
  };
}>;

// Marble Run must not block launch behind MAX's terms/privacy dialog. Keep
// this game-level policy at composition rather than changing the shared SDK's
// defaults for other games.
const MARBLE_RUN_APPLOVIN_PRIVACY_ENV: Env = {
  VITE_APPLOVIN_CONSENT_FLOW_ENABLED: 'false',
  VITE_APPLOVIN_GDPR_TERMS_ALERT_ENABLED: 'false',
};

export interface SdkProviderSelection {
  readonly platform: 'android' | 'ios' | 'web';
  readonly analyticsSinks: readonly string[];
  readonly ads: string;
  readonly attribution: string;
  readonly meta: string;
}

/** Non-secret configured identity per SDK, for the verifier pane. */
export interface SdkConfiguredIds {
  readonly appLovin: AppLovinConfigResult;
  readonly meta: MetaConfigResult;
  readonly firebasePresent: boolean;
  readonly appsFlyerAppleAppId: string | null;
}

export interface GameSdkContext {
  readonly ads: AdProvider;
  readonly meta: MetaProvider;
  readonly attributionProvider: AttributionProvider;
  readonly extraSinks: readonly AnalyticsSink[];
  readonly selection: SdkProviderSelection;
  readonly configuredIds: SdkConfiguredIds;
}

export interface CreateSdkContextDependencies {
  readonly platform?: string;
  readonly isNativePlatform?: boolean;
  readonly env?: Env;
  readonly isProductionBuild?: boolean;
  readonly firebaseAnalyticsLoader?: FirebaseAnalyticsLoader;
  readonly adProviderFactories?: AdProviderFactories;
}

/** Pure synchronous composition. Native modules stay behind lazy transports so
 * web and CI never import them. (Pattern lifted from find_the_dog.) */
export function createSdkContext(deps: CreateSdkContextDependencies = {}): GameSdkContext {
  const env = deps.env ?? (import.meta.env as Env);
  const isProductionBuild = deps.isProductionBuild ?? import.meta.env.PROD === true;
  const platform = normalizePlatform(deps.platform ?? Capacitor.getPlatform());
  const isNativePlatform = deps.isNativePlatform ?? Capacitor.isNativePlatform();

  const lifecycle = {
    onFullScreenAdStarted: (): void => setMusicPausedForAd(true),
    onFullScreenAdFinished: (): void => setMusicPausedForAd(false),
  };
  const appLovinConfig = readAppLovinConfigForPlatform(platform === 'ios' ? 'ios' : 'android', {
    ...env,
    ...MARBLE_RUN_APPLOVIN_PRIVACY_ENV,
  });
  const adFactories: AdProviderFactories = deps.adProviderFactories ?? {
    createAdMobProvider: defaultAdProviderFactories.createAdMobProvider,
    createAppLovinMaxProvider: (config) => new AppLovinMaxProvider(config, {
      lifecycle,
      onAdRevenuePaid: (event): void => {
        void analytics.adRevenuePaid({ ...event });
      },
    }),
    createDisabledProvider: defaultAdProviderFactories.createDisabledProvider,
  };
  const ads = createAdProvider(platform, appLovinConfig, adFactories, lifecycle);

  const attributionProvider = createMarbleRunAttributionProvider(platform, env, isProductionBuild);

  const metaConfig = readMetaConfig(isNativePlatform ? platform : 'web', env);
  const meta = createMetaProvider(metaConfig);

  const extraSinks: AnalyticsSink[] = [];
  // Native Firebase (@capacitor-firebase/analytics) aborts at +[FIRApp configure]
  // when the build ships no Firebase config. Only construct the sink on a native
  // platform when API_KEY+PROJECT_ID+APP_ID are all present; includePlugins.ts
  // keeps the pod itself out of config-less native builds.
  if (isNativePlatform && (platform === 'ios' || platform === 'android') && firebaseConfigPresent(env)) {
    extraSinks.push(createFirebaseSink(createLazyFirebaseTransport(
      deps.firebaseAnalyticsLoader ?? (() => import('@capacitor-firebase/analytics')),
    )));
  }

  return {
    ads,
    meta,
    attributionProvider,
    extraSinks,
    selection: {
      platform,
      analyticsSinks: extraSinks.map((sink) => sink.name),
      ads: ads.providerName,
      attribution: attributionProvider.providerName,
      meta: meta.providerName,
    },
    configuredIds: {
      appLovin: appLovinConfig,
      meta: metaConfig,
      firebasePresent: firebaseConfigPresent(env),
      appsFlyerAppleAppId: envString(env.VITE_APPSFLYER_APPLE_APP_ID),
    },
  };
}

let installedContext: GameSdkContext | null = null;

export function installSdkContext(context: GameSdkContext): GameSdkContext {
  installedContext = context;
  configureAdService(context.ads);
  attribution.configureProvider(context.attributionProvider);
  analytics.configureExtraSinks(context.extraSinks);
  return context;
}

export function getSdkContext(): GameSdkContext {
  return installedContext ?? installSdkContext(createSdkContext());
}

function normalizePlatform(value: string): 'android' | 'ios' | 'web' {
  return value === 'ios' || value === 'android' ? value : 'web';
}

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
