import type {
  AppsFlyerAttributionPlugin,
  AppsFlyerTrackEventOptions,
} from './AppsFlyerAttributionPlugin.ts';
import { AppsFlyerAttribution } from './AppsFlyerAttributionPlugin.ts';
import type { AppsFlyerConfig } from './AppsFlyerConfig.ts';
import { redactAppsFlyerKey } from './AppsFlyerConfig.ts';
import type {
  AttributionEventName,
  AttributionParamBag,
  AttributionParams,
  AttributionProvider,
} from './AttributionProvider.ts';
import { isTimeoutError, withTimeout } from '../with-timeout.ts';

const NATIVE_INIT_TIMEOUT_MS = 5_000;
const NATIVE_TRACK_TIMEOUT_MS = 3_000;

export interface AppsFlyerAttributionProviderOptions {
  plugin?: AppsFlyerAttributionPlugin;
  logger?: Pick<Console, 'info' | 'warn'>;
  timeoutMs?: {
    init: number;
    track: number;
  };
}

export class AppsFlyerAttributionProvider implements AttributionProvider {
  readonly providerName = 'appsflyer';
  private readonly plugin: AppsFlyerAttributionPlugin;
  private readonly logger: Pick<Console, 'info' | 'warn'>;
  private readonly timeoutMs: { init: number; track: number };
  private initialized = false;
  private permanentlyDisabled = false;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly config: AppsFlyerConfig,
    options: AppsFlyerAttributionProviderOptions = {},
  ) {
    this.plugin = options.plugin ?? AppsFlyerAttribution;
    this.logger = options.logger ?? console;
    this.timeoutMs = options.timeoutMs ?? {
      init: NATIVE_INIT_TIMEOUT_MS,
      track: NATIVE_TRACK_TIMEOUT_MS,
    };
  }

  async init(): Promise<void> {
    if (this.initialized || this.permanentlyDisabled) return;
    if (this.initPromise !== null) return this.initPromise;

    this.initPromise = (async (): Promise<void> => {
      try {
        this.log('initializing AppsFlyer', {
          devKey: redactAppsFlyerKey(this.config.devKey),
          appleAppId: this.config.appleAppId,
          debugLogging: this.config.debugLogging,
          attWaitSeconds: this.config.attWaitSeconds,
        });
        const result = await withTimeout(
          this.plugin.initialize({
            devKey: this.config.devKey,
            appleAppId: this.config.appleAppId,
            debugLogging: this.config.debugLogging,
            attWaitSeconds: this.config.attWaitSeconds,
          }),
          this.timeoutMs.init,
          'AppsFlyer initialization',
        );
        this.initialized = result.initialized === true;
        this.permanentlyDisabled = !this.initialized;
        this.log(this.initialized ? 'AppsFlyer initialized' : 'AppsFlyer init returned disabled');
      } catch (err: unknown) {
        this.initialized = false;
        this.permanentlyDisabled = !isTimeoutError(err);
        this.warn('AppsFlyer initialization failed', err);
      }
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async track<P extends AttributionParamBag<P>>(eventName: AttributionEventName, params?: P): Promise<void> {
    await this.init();
    if (!this.initialized || this.permanentlyDisabled) return;

    try {
      const options: AppsFlyerTrackEventOptions = {
        eventName,
        eventValues: serializeParams(params ?? {}),
      };
      const result = await withTimeout(
        this.plugin.trackEvent(options),
        this.timeoutMs.track,
        `AppsFlyer event track: ${eventName}`,
      );
      if (result.tracked !== true) {
        this.log(`event not tracked by native bridge: ${eventName}`);
      }
    } catch (err: unknown) {
      this.warn(`event track failed: ${eventName}`, err);
    }
  }

  private log(message: string, details?: Record<string, unknown>): void {
    this.logger.info(`[attribution:appsflyer] ${message}`, details ?? '');
  }

  private warn(message: string, err: unknown): void {
    this.logger.warn(`[attribution:appsflyer] ${message}`, err);
  }
}

function serializeParams(params: AttributionParams): Record<string, string> {
  const serialized: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    serialized[key] = String(value);
  }
  return serialized;
}
