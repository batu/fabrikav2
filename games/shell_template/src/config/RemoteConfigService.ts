import {
  REMOTE_CONFIG_DEFAULTS,
  mapRemoteConfigValues,
  type RemoteConfigValues,
  type RemoteConfigValueKey,
} from './remoteConfigSchema';

export type RemoteConfigServiceState = 'local-only' | 'ready' | 'fetch-failed';
export type RemoteConfigValueSource = 'default' | 'remote' | 'local';

export interface RemoteConfigSnapshot {
  state: RemoteConfigServiceState;
  defaults: RemoteConfigValues;
  active: RemoteConfigValues;
  sources: Record<RemoteConfigValueKey, RemoteConfigValueSource>;
  lastFetchStatus: 'unavailable' | 'success' | 'failure';
  fetchTimeMillis: number;
  lastErrorMessage: string | null;
}

function readLocalTestOverrides(): Partial<RemoteConfigValues> {
  if (typeof window === 'undefined') return {};
  if (import.meta.env.DEV !== true) return {};
  const raw = window.localStorage.getItem('ftd_remote_config_test_overrides');
  if (raw === null) return {};
  return JSON.parse(raw) as Partial<RemoteConfigValues>;
}

export class RemoteConfigService {
  private state: RemoteConfigServiceState = 'local-only';
  private testOverrides: Partial<RemoteConfigValues> = readLocalTestOverrides();
  private lastErrorMessage: string | null = null;
  private fetchTimeMillis = -1;

  init(): void {
    this.state = 'ready';
  }

  async initAndWait(): Promise<void> {
    this.init();
  }

  async initAndWaitForTest(): Promise<void> {
    await this.initAndWait();
  }

  value<TKey extends RemoteConfigValueKey>(key: TKey): RemoteConfigValues[TKey] {
    const override = this.testOverrides[key];
    if (override !== undefined) return override as RemoteConfigValues[TKey];
    return REMOTE_CONFIG_DEFAULTS[key];
  }

  setValuesForTest(values: Partial<RemoteConfigValues>): void {
    this.testOverrides = { ...this.testOverrides, ...values };
    this.state = 'ready';
  }

  snapshot(): RemoteConfigSnapshot {
    const active = this.activeValues();
    return {
      state: this.state,
      defaults: { ...REMOTE_CONFIG_DEFAULTS },
      active,
      sources: this.valueSources(),
      lastFetchStatus: this.state === 'fetch-failed' ? 'failure' : 'unavailable',
      fetchTimeMillis: this.fetchTimeMillis,
      lastErrorMessage: this.lastErrorMessage,
    };
  }

  private activeValues(): RemoteConfigValues {
    return mapRemoteConfigValues((key) => this.value(key));
  }

  private valueSources(): Record<RemoteConfigValueKey, RemoteConfigValueSource> {
    const sources = {} as Record<RemoteConfigValueKey, RemoteConfigValueSource>;
    for (const key of Object.keys(REMOTE_CONFIG_DEFAULTS) as RemoteConfigValueKey[]) {
      sources[key] = this.testOverrides[key] === undefined ? 'default' : 'remote';
    }
    return sources;
  }
}

export const remoteConfigService = new RemoteConfigService();
