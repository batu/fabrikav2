import { CapacitorMetaProvider } from './CapacitorMetaProvider.ts';
import type { MetaConfig, MetaConfigResult } from './MetaConfig.ts';
import type { MetaEventParams, MetaProvider, MetaProviderStatus } from './MetaProvider.ts';

export class DisabledMetaProvider implements MetaProvider {
  readonly providerName = 'meta-disabled';
  private didLogReason = false;

  constructor(
    private readonly reason: string,
    private readonly logger: Pick<Console, 'info'> = console,
  ) {}

  getStatus(): MetaProviderStatus {
    return { state: 'not-configured', reason: this.reason };
  }

  async init(): Promise<void> {
    this.logReasonOnce();
  }

  async logEvent(_eventName: string, _params?: MetaEventParams): Promise<void> {
    this.logReasonOnce();
  }

  async setAdvertiserTrackingEnabled(_enabled: boolean): Promise<void> {
    this.logReasonOnce();
  }

  private logReasonOnce(): void {
    if (this.didLogReason) return;
    this.didLogReason = true;
    this.logger.info(`[meta:disabled] ${this.reason}`);
  }
}

export interface MetaProviderFactories {
  createEnabled: (config: MetaConfig) => MetaProvider;
  createDisabled: (reason: string) => MetaProvider;
}

const defaultMetaProviderFactories: MetaProviderFactories = {
  createEnabled: (config: MetaConfig): MetaProvider => new CapacitorMetaProvider(config),
  createDisabled: (reason: string): MetaProvider => new DisabledMetaProvider(reason),
};

export function createMetaProvider(
  configResult: MetaConfigResult,
  factories: MetaProviderFactories = defaultMetaProviderFactories,
): MetaProvider {
  if (!configResult.enabled) {
    return factories.createDisabled(configResult.reason);
  }
  return factories.createEnabled(configResult.config);
}
