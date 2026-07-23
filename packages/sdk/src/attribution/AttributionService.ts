import { Capacitor } from '@capacitor/core';
import { AdjustAttributionProvider } from './AdjustAttributionProvider.ts';
import { readAdjustIosConfig, type AdjustConfigResult } from './AdjustConfig.ts';
import { AppsFlyerAttributionProvider } from './AppsFlyerAttributionProvider.ts';
import { readAppsFlyerConfig, type AppsFlyerConfig, type AppsFlyerConfigResult } from './AppsFlyerConfig.ts';
import type {
  AttributionEventName,
  AttributionParamBag,
  AttributionProvider,
} from './AttributionProvider.ts';
import { DisabledAttributionProvider } from './DisabledAttributionProvider.ts';
import { withTimeout } from '../with-timeout.ts';

const STARTUP_GATE_TIMEOUT_MS = 5_000;

type EnabledAdjustConfig = Extract<AdjustConfigResult, { enabled: true }>['config'];

export interface AttributionProviderFactories {
  createAdjustProvider: (config: EnabledAdjustConfig) => AttributionProvider;
  /** Optional for pre-AppsFlyer callers; selectAttributionProvider falls back
   * to the default AppsFlyer factory when absent. */
  createAppsFlyerProvider?: (config: AppsFlyerConfig) => AttributionProvider;
  createDisabledProvider: (reason: string) => AttributionProvider;
}

export interface AttributionServiceOptions {
  startupGate?: Promise<void>;
  startupGateTimeoutMs?: number;
  logger?: Pick<Console, 'warn'>;
}

const defaultAttributionProviderFactories: AttributionProviderFactories = {
  createAdjustProvider: (config: EnabledAdjustConfig): AttributionProvider => new AdjustAttributionProvider(config),
  createAppsFlyerProvider: (config: AppsFlyerConfig): AttributionProvider => new AppsFlyerAttributionProvider(config),
  createDisabledProvider: (reason: string): AttributionProvider => new DisabledAttributionProvider(reason),
};

export function createAttributionProvider(
  platform: string = Capacitor.getPlatform(),
  adjustConfig: AdjustConfigResult = readAdjustIosConfig(),
  factories: AttributionProviderFactories = defaultAttributionProviderFactories,
): AttributionProvider {
  if (platform !== 'ios') {
    return factories.createDisabledProvider(`Adjust disabled on ${platform || 'web'} platform`);
  }

  if (!adjustConfig.enabled) {
    return factories.createDisabledProvider(`iOS Adjust unavailable: ${adjustConfig.reason}`);
  }

  return factories.createAdjustProvider(adjustConfig.config);
}

export type AttributionProviderChoice = 'appsflyer' | 'adjust' | 'disabled';

export interface SelectAttributionProviderOptions {
  platform?: string;
  preferred?: AttributionProviderChoice | null;
  adjustConfig?: AdjustConfigResult;
  appsFlyerConfig?: AppsFlyerConfigResult;
  factories?: AttributionProviderFactories;
}

/**
 * Multi-provider selection: an explicit `preferred` choice wins when its config
 * is enabled; otherwise the first configured provider wins (AppsFlyer before
 * Adjust). Everything else resolves to a Disabled provider with a reason —
 * "off" is a first-class state, never an error.
 */
export function selectAttributionProvider(
  options: SelectAttributionProviderOptions = {},
): AttributionProvider {
  const platform = options.platform ?? Capacitor.getPlatform();
  const factories = options.factories ?? defaultAttributionProviderFactories;
  const createAppsFlyerProvider =
    factories.createAppsFlyerProvider ?? defaultAttributionProviderFactories.createAppsFlyerProvider!;
  const appsFlyerConfig = options.appsFlyerConfig ?? readAppsFlyerConfig(platform);
  const adjustConfig = options.adjustConfig ?? readAdjustIosConfig();
  const preferred = options.preferred ?? null;

  if (preferred === 'disabled') {
    return factories.createDisabledProvider('attribution disabled by explicit configuration');
  }

  if (preferred === 'appsflyer') {
    return appsFlyerConfig.enabled
      ? createAppsFlyerProvider(appsFlyerConfig.config)
      : factories.createDisabledProvider(`AppsFlyer unavailable: ${appsFlyerConfig.reason}`);
  }

  if (preferred === 'adjust') {
    return createAttributionProvider(platform, adjustConfig, factories);
  }

  if (appsFlyerConfig.enabled) {
    return createAppsFlyerProvider(appsFlyerConfig.config);
  }
  if (platform === 'ios' && adjustConfig.enabled) {
    return factories.createAdjustProvider(adjustConfig.config);
  }
  return factories.createDisabledProvider(
    `no attribution provider configured (AppsFlyer: ${appsFlyerConfig.enabled ? 'enabled' : appsFlyerConfig.reason}; Adjust: ${adjustConfig.enabled ? `enabled but platform is ${platform}` : adjustConfig.reason})`,
  );
}

export class AttributionService {
  private startupGate: Promise<void>;
  private readonly logger: Pick<Console, 'warn'>;

  constructor(
    private readonly provider: AttributionProvider = createAttributionProvider(),
    options: AttributionServiceOptions = {},
  ) {
    this.logger = options.logger ?? console;
    this.startupGate = this.normalizeStartupGate(
      options.startupGate ?? Promise.resolve(),
      options.startupGateTimeoutMs ?? STARTUP_GATE_TIMEOUT_MS,
    );
  }

  configureStartupGate(gate: Promise<void>, timeoutMs: number = STARTUP_GATE_TIMEOUT_MS): void {
    this.startupGate = this.normalizeStartupGate(gate, timeoutMs);
  }

  async init(): Promise<void> {
    await this.startupGate;
    return this.provider.init();
  }

  appOpen<P extends AttributionParamBag<P>>(params?: P): Promise<void> {
    return this.trackAfterStartupGate('appOpen', params ?? {});
  }

  levelStart<P extends AttributionParamBag<P>>(params: P): Promise<void> {
    return this.trackAfterStartupGate('levelStart', params);
  }

  levelComplete<P extends AttributionParamBag<P>>(params: P): Promise<void> {
    return this.trackAfterStartupGate('levelComplete', params);
  }

  levelFailed<P extends AttributionParamBag<P>>(params: P): Promise<void> {
    return this.trackAfterStartupGate('levelFailed', params);
  }

  rewardedWatched<P extends AttributionParamBag<P>>(params: P): Promise<void> {
    return this.trackAfterStartupGate('rewardedWatched', params);
  }

  private async trackAfterStartupGate<P extends AttributionParamBag<P>>(
    eventName: AttributionEventName,
    params: P,
  ): Promise<void> {
    await this.startupGate;
    return this.provider.track(eventName, params);
  }

  private normalizeStartupGate(gate: Promise<void>, timeoutMs: number): Promise<void> {
    return withTimeout(gate, timeoutMs, 'Attribution startup gate').catch((err: unknown): void => {
      this.logger.warn('[attribution] startup gate failed; continuing with attribution fallback', err);
    });
  }
}
