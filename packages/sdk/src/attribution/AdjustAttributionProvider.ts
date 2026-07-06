import type {
  AdjustAttributionPlugin,
  AdjustTrackEventOptions,
} from './AdjustAttributionPlugin.ts';
import { AdjustAttribution } from './AdjustAttributionPlugin.ts';
import type { AdjustIosConfig } from './AdjustConfig.ts';
import { redactAdjustToken } from './AdjustConfig.ts';
import type {
  AttributionEventName,
  AttributionParamBag,
  AttributionParams,
  AttributionProvider,
} from './AttributionProvider.ts';
import { isTimeoutError, withTimeout } from '../with-timeout.ts';

const NATIVE_INIT_TIMEOUT_MS = 5_000;
const NATIVE_TRACK_TIMEOUT_MS = 3_000;

export interface AdjustAttributionProviderOptions {
  plugin?: AdjustAttributionPlugin;
  logger?: Pick<Console, 'info' | 'warn'>;
  timeoutMs?: {
    init: number;
    track: number;
  };
}

export class AdjustAttributionProvider implements AttributionProvider {
  readonly providerName = 'adjust-ios';
  private readonly plugin: AdjustAttributionPlugin;
  private readonly logger: Pick<Console, 'info' | 'warn'>;
  private readonly timeoutMs: { init: number; track: number };
  private initialized = false;
  private permanentlyDisabled = false;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly config: AdjustIosConfig,
    options: AdjustAttributionProviderOptions = {},
  ) {
    this.plugin = options.plugin ?? AdjustAttribution;
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
        this.log('initializing Adjust', {
          appToken: redactAdjustToken(this.config.appToken),
          environment: this.config.environment,
          verboseLogging: this.config.verboseLogging,
          disableIdfaReading: this.config.privacy.disableIdfaReading,
          disableAppTrackingTransparencyUsage: this.config.privacy.disableAppTrackingTransparencyUsage,
        });
        const result = await withTimeout(
          this.plugin.initialize({
            appToken: this.config.appToken,
            environment: this.config.environment,
            verboseLogging: this.config.verboseLogging,
            disableIdfaReading: this.config.privacy.disableIdfaReading,
            disableAppTrackingTransparencyUsage: this.config.privacy.disableAppTrackingTransparencyUsage,
            eventTokens: configuredEventTokens(this.config.eventTokens),
          }),
          this.timeoutMs.init,
          'Adjust initialization',
        );
        this.initialized = result.initialized === true;
        this.permanentlyDisabled = !this.initialized;
        this.log(this.initialized ? 'Adjust initialized' : 'Adjust init returned disabled');
      } catch (err: unknown) {
        this.initialized = false;
        this.permanentlyDisabled = !isTimeoutError(err);
        this.warn('Adjust initialization failed', err);
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

    const eventToken = this.config.eventTokens[eventName];
    if (eventToken === null) {
      this.log(`event skipped; missing token for ${eventName}`);
      return;
    }

    try {
      const options: AdjustTrackEventOptions = {
        eventName,
        callbackParameters: serializeParams(params ?? {}),
      };
      const result = await withTimeout(
        this.plugin.trackEvent(options),
        this.timeoutMs.track,
        `Adjust event track: ${eventName}`,
      );
      if (result.tracked !== true) {
        this.log(`event not tracked by native bridge: ${eventName}`);
      }
    } catch (err: unknown) {
      this.warn(`event track failed: ${eventName}`, err);
    }
  }

  private log(message: string, details?: Record<string, unknown>): void {
    this.logger.info(`[attribution:adjust] ${message}`, details ?? '');
  }

  private warn(message: string, err: unknown): void {
    this.logger.warn(`[attribution:adjust] ${message}`, err);
  }
}

function configuredEventTokens(eventTokens: Record<AttributionEventName, string | null>): Record<string, string> {
  const configured: Record<string, string> = {};
  for (const [eventName, eventToken] of Object.entries(eventTokens)) {
    if (eventToken !== null) {
      configured[eventName] = eventToken;
    }
  }
  return configured;
}

function serializeParams(params: AttributionParams): Record<string, string> {
  const serialized: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    serialized[key] = String(value);
  }
  return serialized;
}
