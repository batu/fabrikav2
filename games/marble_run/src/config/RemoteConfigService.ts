import {
  REMOTE_CONFIG_DEFAULTS,
  mapRemoteConfigValues,
  type RemoteConfigValues,
  type RemoteConfigValueKey,
} from './remoteConfigSchema';
import { fetchRemoteConfig, readFetchCredentials } from './remoteConfigFetch';

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
  // Node-environment unit tests can carry a bare `window` shim with no storage.
  if (typeof window.localStorage === 'undefined') return {};
  const raw = window.localStorage.getItem('ftd_remote_config_test_overrides');
  if (raw === null) return {};
  return JSON.parse(raw) as Partial<RemoteConfigValues>;
}

const REMOTE_CACHE_STORAGE_KEY = 'marble_run_remote_config_cache';

/**
 * Last successful fetch, replayed at the next cold start so a launch with no
 * network still runs the live values rather than snapping back to the compiled
 * defaults.
 */
function readCachedRemoteValues(): Partial<RemoteConfigValues> {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return {};
  const raw = window.localStorage.getItem(REMOTE_CACHE_STORAGE_KEY);
  if (raw === null) return {};
  try {
    return JSON.parse(raw) as Partial<RemoteConfigValues>;
  } catch {
    return {};
  }
}

function writeCachedRemoteValues(values: Partial<RemoteConfigValues>): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.setItem(REMOTE_CACHE_STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Storage full or blocked: the in-memory values still apply this session.
  }
}

export class RemoteConfigService {
  private state: RemoteConfigServiceState = 'local-only';
  private testOverrides: Partial<RemoteConfigValues> = readLocalTestOverrides();
  private remoteValues: Partial<RemoteConfigValues> = readCachedRemoteValues();
  private lastFetchStatus: 'unavailable' | 'success' | 'failure' = 'unavailable';
  private lastErrorMessage: string | null = null;
  private fetchTimeMillis = -1;
  private inFlight: Promise<void> | null = null;

  init(): void {
    this.state = 'ready';
    void this.refresh();
  }

  async initAndWait(): Promise<void> {
    this.state = 'ready';
    await this.refresh();
  }

  /**
   * Fetch once per call, de-duplicated while in flight. A failure is not fatal:
   * cached values (then compiled defaults) remain active and the state carries
   * the reason for the SDK verifier pane.
   */
  async refresh(): Promise<void> {
    if (this.inFlight !== null) return this.inFlight;
    const credentials = readFetchCredentials(
      import.meta.env as unknown as Record<string, string | undefined>,
    );
    if (credentials === null) {
      this.lastFetchStatus = 'unavailable';
      this.lastErrorMessage = 'Firebase config absent; remote config not fetched.';
      return;
    }
    this.inFlight = fetchRemoteConfig(credentials)
      .then((outcome) => {
        this.fetchTimeMillis = Date.now();
        if (outcome.status === 'updated') {
          this.remoteValues = outcome.values;
          writeCachedRemoteValues(outcome.values);
          this.lastFetchStatus = 'success';
          this.lastErrorMessage = null;
          this.state = 'ready';
          return;
        }
        if (outcome.status === 'no-template') {
          this.lastFetchStatus = 'success';
          this.lastErrorMessage = 'No Remote Config template published for this project.';
          this.state = 'ready';
          return;
        }
        this.lastFetchStatus = 'failure';
        this.lastErrorMessage = outcome.reason;
        this.state = 'fetch-failed';
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  async initAndWaitForTest(): Promise<void> {
    await this.initAndWait();
  }

  value<TKey extends RemoteConfigValueKey>(key: TKey): RemoteConfigValues[TKey] {
    const override = this.testOverrides[key];
    if (override !== undefined) return override as RemoteConfigValues[TKey];
    const remote = this.remoteValues[key];
    if (remote !== undefined) return remote as RemoteConfigValues[TKey];
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
      lastFetchStatus: this.lastFetchStatus,
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
      if (this.testOverrides[key] !== undefined) {
        sources[key] = 'local';
      } else if (this.remoteValues[key] !== undefined) {
        sources[key] = 'remote';
      } else {
        sources[key] = 'default';
      }
    }
    return sources;
  }
}

export const remoteConfigService = new RemoteConfigService();
