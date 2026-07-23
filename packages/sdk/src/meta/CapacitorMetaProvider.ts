import type { CapacitorMetaPlugin, MetaLogEventOptions } from './CapacitorMetaPlugin.ts';
import { MetaEvents } from './CapacitorMetaPlugin.ts';
import type { MetaConfig } from './MetaConfig.ts';
import { redactMetaToken } from './MetaConfig.ts';
import type { MetaEventParams, MetaProvider, MetaProviderStatus } from './MetaProvider.ts';
import { isTimeoutError, withTimeout } from '../with-timeout.ts';

const NATIVE_INIT_TIMEOUT_MS = 5_000;
const NATIVE_CALL_TIMEOUT_MS = 3_000;

export interface CapacitorMetaProviderOptions {
  plugin?: CapacitorMetaPlugin;
  logger?: Pick<Console, 'info' | 'warn'>;
  timeoutMs?: {
    init: number;
    call: number;
  };
}

export class CapacitorMetaProvider implements MetaProvider {
  readonly providerName = 'meta-capacitor';
  private readonly plugin: CapacitorMetaPlugin;
  private readonly logger: Pick<Console, 'info' | 'warn'>;
  private readonly timeoutMs: { init: number; call: number };
  private status: MetaProviderStatus = { state: 'idle' };
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly config: MetaConfig,
    options: CapacitorMetaProviderOptions = {},
  ) {
    this.plugin = options.plugin ?? MetaEvents;
    this.logger = options.logger ?? console;
    this.timeoutMs = options.timeoutMs ?? {
      init: NATIVE_INIT_TIMEOUT_MS,
      call: NATIVE_CALL_TIMEOUT_MS,
    };
  }

  getStatus(): MetaProviderStatus {
    return this.status;
  }

  async init(): Promise<void> {
    if (this.status.state === 'initialized' || this.status.state === 'error') return;
    if (this.initPromise !== null) return this.initPromise;

    this.initPromise = (async (): Promise<void> => {
      try {
        this.log('initializing Facebook SDK', {
          appId: this.config.appId,
          clientToken: redactMetaToken(this.config.clientToken),
          autoLogAppEvents: this.config.autoLogAppEvents,
          advertiserIdCollection: this.config.advertiserIdCollection,
        });
        const result = await withTimeout(
          this.plugin.initialize({
            appId: this.config.appId,
            clientToken: this.config.clientToken,
            autoLogAppEvents: this.config.autoLogAppEvents,
            advertiserIdCollection: this.config.advertiserIdCollection,
          }),
          this.timeoutMs.init,
          'Facebook SDK initialization',
        );
        if (result.initialized === true) {
          this.status = { state: 'initialized' };
          this.log('Facebook SDK initialized');
        } else {
          this.status = { state: 'error', reason: 'native init returned uninitialized' };
          this.warn('Facebook SDK init returned uninitialized', null);
        }
      } catch (err: unknown) {
        // A timeout may be transient; leave status idle so a later init can retry.
        this.status = isTimeoutError(err)
          ? { state: 'idle' }
          : { state: 'error', reason: describeError(err) };
        this.warn('Facebook SDK initialization failed', err);
      }
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async logEvent(eventName: string, params?: MetaEventParams): Promise<void> {
    await this.init();
    if (this.status.state !== 'initialized') return;

    try {
      const options: MetaLogEventOptions = {
        eventName,
        parameters: serializeParams(params ?? {}),
      };
      const result = await withTimeout(
        this.plugin.logEvent(options),
        this.timeoutMs.call,
        `Facebook event log: ${eventName}`,
      );
      if (result.logged !== true) {
        this.log(`event not logged by native bridge: ${eventName}`);
      }
    } catch (err: unknown) {
      this.warn(`event log failed: ${eventName}`, err);
    }
  }

  async setAdvertiserTrackingEnabled(enabled: boolean): Promise<void> {
    if (this.status.state !== 'initialized') return;

    try {
      await withTimeout(
        this.plugin.setAdvertiserTrackingEnabled({ enabled }),
        this.timeoutMs.call,
        'Facebook advertiser tracking update',
      );
    } catch (err: unknown) {
      this.warn('advertiser tracking update failed', err);
    }
  }

  private log(message: string, details?: Record<string, unknown>): void {
    this.logger.info(`[meta] ${message}`, details ?? '');
  }

  private warn(message: string, err: unknown): void {
    this.logger.warn(`[meta] ${message}`, err ?? '');
  }
}

function serializeParams(params: MetaEventParams): Record<string, string> {
  const serialized: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    serialized[key] = String(value);
  }
  return serialized;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
