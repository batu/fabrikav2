import {
  createRemoteConfigService,
  type RemoteConfigProvider,
  type RemoteConfigService as SharedRemoteConfigService,
} from '@fabrikav2/services/remote-config';
import {
  REMOTE_CONFIG_DEFAULTS,
  ftdRemoteConfigSchema,
  mapRemoteConfigSources,
  mapRemoteConfigValues,
  type FtdRemoteConfigSchema,
  type RemoteConfigValues,
  type RemoteConfigValueKey,
} from './remoteConfigSchema';

export type RemoteConfigServiceState = 'local-only' | 'fetching' | 'ready' | 'fetch-failed';
export type RemoteConfigValueSource = 'default' | 'remote' | 'local';
export type RemoteConfigFetchStatus = 'unavailable' | 'success' | 'failure';

export interface RemoteConfigSnapshot {
  state: RemoteConfigServiceState;
  defaults: RemoteConfigValues;
  active: RemoteConfigValues;
  sources: Record<RemoteConfigValueKey, RemoteConfigValueSource>;
  lastFetchStatus: RemoteConfigFetchStatus;
  fetchTimeMillis: number;
  lastErrorMessage: string | null;
}

export interface RemoteConfigProviderSnapshot {
  lastFetchStatus: RemoteConfigFetchStatus;
  fetchTimeMillis: number;
  lastErrorMessage: string | null;
}

/** Optional side channel for provider-specific fetch diagnostics. */
export interface RemoteConfigProviderMetadata {
  snapshot(): RemoteConfigProviderSnapshot;
}

function readLocalTestOverrides(): Partial<RemoteConfigValues> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return {};
  if (import.meta.env.DEV !== true) return {};
  const storage = window.localStorage;
  if (storage === undefined) return {};
  const raw = storage.getItem('ftd_remote_config_test_overrides');
  if (raw === null) return {};
  return JSON.parse(raw) as Partial<RemoteConfigValues>;
}

export class RemoteConfigService {
  private readonly shared: SharedRemoteConfigService<FtdRemoteConfigSchema>;
  private initPromise: Promise<void> | null = null;
  private testOverrides: Partial<RemoteConfigValues> = {};
  private localOverridesLoaded = false;
  private installedService: RemoteConfigService | null = null;

  constructor(
    provider?: RemoteConfigProvider,
    private readonly providerMetadata?: RemoteConfigProviderMetadata,
  ) {
    this.shared = createRemoteConfigService(ftdRemoteConfigSchema, { provider });
  }

  init(): void {
    if (this.installedService !== null) {
      this.installedService.init();
      return;
    }
    if (this.initPromise !== null) return;
    this.initPromise = this.shared.refresh();
  }

  initAndWait(): Promise<void> {
    if (this.installedService !== null) return this.installedService.initAndWait();
    this.init();
    return this.initPromise ?? Promise.resolve();
  }

  initAndWaitForTest(): Promise<void> {
    if (this.installedService !== null) return this.installedService.initAndWaitForTest();
    return this.initAndWait();
  }

  value<TKey extends RemoteConfigValueKey>(key: TKey): RemoteConfigValues[TKey] {
    if (this.installedService !== null) return this.installedService.value(key);
    this.ensureLocalOverridesLoaded();
    const override = this.testOverrides[key];
    if (override !== undefined) return override as RemoteConfigValues[TKey];
    return this.shared.value(key) as RemoteConfigValues[TKey];
  }

  setValuesForTest(values: Partial<RemoteConfigValues>): void {
    if (this.installedService !== null) {
      this.installedService.setValuesForTest(values);
      return;
    }
    this.ensureLocalOverridesLoaded();
    this.testOverrides = { ...this.testOverrides, ...values };
  }

  snapshot(): RemoteConfigSnapshot {
    if (this.installedService !== null) return this.installedService.snapshot();
    const sharedSnapshot = this.shared.snapshot();
    const providerSnapshot = this.providerMetadata?.snapshot();
    const lastFetchStatus = providerSnapshot?.lastFetchStatus
      ?? (sharedSnapshot.state === 'ready'
        ? 'success'
        : sharedSnapshot.state === 'fetch-failed'
          ? 'failure'
          : 'unavailable');

    return {
      state: lastFetchStatus === 'failure' ? 'fetch-failed' : sharedSnapshot.state,
      defaults: { ...REMOTE_CONFIG_DEFAULTS },
      active: this.activeValues(),
      sources: this.valueSources(sharedSnapshot.origins),
      lastFetchStatus,
      fetchTimeMillis: providerSnapshot?.fetchTimeMillis ?? sharedSnapshot.lastFetchAtMs ?? -1,
      lastErrorMessage: providerSnapshot?.lastErrorMessage ?? sharedSnapshot.lastErrorMessage,
    };
  }

  private activeValues(): RemoteConfigValues {
    return mapRemoteConfigValues((key) => this.value(key));
  }

  private ensureLocalOverridesLoaded(): void {
    if (this.localOverridesLoaded) return;
    this.localOverridesLoaded = true;
    this.testOverrides = readLocalTestOverrides();
  }

  /** Repoint the stable compatibility singleton at the composition-owned service. */
  install(service: RemoteConfigService): void {
    if (service === this) return;
    this.installedService = service;
  }

  private valueSources(
    origins: Record<RemoteConfigValueKey, 'default' | 'remote'>,
  ): Record<RemoteConfigValueKey, RemoteConfigValueSource> {
    return mapRemoteConfigSources((key) => (
      this.testOverrides[key] === undefined ? origins[key] : 'local'
    ));
  }
}

export function createFtdRemoteConfigService(
  provider?: RemoteConfigProvider,
  metadata?: RemoteConfigProviderMetadata,
): RemoteConfigService {
  return new RemoteConfigService(provider, metadata);
}

/** Web/CI default: no provider means static validated defaults by construction. */
export const remoteConfigService = createFtdRemoteConfigService();

export function configureRemoteConfigService(service: RemoteConfigService): void {
  remoteConfigService.install(service);
}
