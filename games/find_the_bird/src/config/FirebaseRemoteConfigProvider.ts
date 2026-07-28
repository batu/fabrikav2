import type { FirebaseApp } from 'firebase/app';
import type { RemoteConfig } from 'firebase/remote-config';
import type { RemoteConfigProvider } from '@fabrikav2/services/remote-config';
import { firebaseDefaultConfig, REMOTE_CONFIG_DEFINITIONS } from './remoteConfigSchema';
import type {
  RemoteConfigProviderMetadata,
  RemoteConfigProviderSnapshot,
} from './RemoteConfigService';

interface FirebaseRemoteConfigValue {
  asString(): string;
  getSource(): 'static' | 'default' | 'remote';
}

interface FirebaseRemoteConfigInstance {
  defaultConfig: Record<string, boolean | number | string>;
  settings: {
    minimumFetchIntervalMillis: number;
    fetchTimeoutMillis: number;
  };
  lastFetchStatus: string;
  fetchTimeMillis: number;
}

export interface FirebaseRemoteConfigProviderDependencies {
  isDev(): boolean;
  getFirebaseApp(): object | null;
  isSupported(): Promise<boolean>;
  getRemoteConfig(app: object): FirebaseRemoteConfigInstance;
  ensureInitialized(remoteConfig: FirebaseRemoteConfigInstance): Promise<void>;
  fetchAndActivate(remoteConfig: FirebaseRemoteConfigInstance): Promise<boolean>;
  getValue(remoteConfig: FirebaseRemoteConfigInstance, remoteKey: string): FirebaseRemoteConfigValue;
}

const devFetchIntervalMs = 60_000;
const prodFetchIntervalMs = 43_200_000;
const devFetchTimeoutMs = 10_000;
const prodFetchTimeoutMs = 5_000;

function isDevBuild(): boolean {
  return import.meta.env.DEV === true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadDefaultDependencies(): Promise<FirebaseRemoteConfigProviderDependencies> {
  const [{ getFirebaseApp }, remoteConfigSdk] = await Promise.all([
    import('../analytics/firebaseApp'),
    import('firebase/remote-config'),
  ]);

  return {
    isDev: isDevBuild,
    getFirebaseApp,
    isSupported: remoteConfigSdk.isSupported,
    getRemoteConfig: (app) => remoteConfigSdk.getRemoteConfig(app as FirebaseApp),
    ensureInitialized: (remoteConfig) => remoteConfigSdk.ensureInitialized(remoteConfig as RemoteConfig),
    fetchAndActivate: (remoteConfig) => remoteConfigSdk.fetchAndActivate(remoteConfig as RemoteConfig),
    getValue: (remoteConfig, remoteKey) => remoteConfigSdk.getValue(remoteConfig as RemoteConfig, remoteKey),
  };
}

/**
 * Game-owned Firebase adapter. Its runtime Firebase imports stay behind fetch(),
 * so the web/static composition never evaluates native remote-config wiring.
 */
export class FirebaseRemoteConfigProvider implements RemoteConfigProvider, RemoteConfigProviderMetadata {
  private metadata: RemoteConfigProviderSnapshot = {
    lastFetchStatus: 'unavailable',
    fetchTimeMillis: -1,
    lastErrorMessage: null,
  };

  constructor(private readonly injectedDependencies?: FirebaseRemoteConfigProviderDependencies) {}

  async fetch(): Promise<Record<string, unknown>> {
    try {
      return await this.fetchWithDependencies(
        this.injectedDependencies ?? await loadDefaultDependencies(),
      );
    } catch (error) {
      this.metadata = {
        ...this.metadata,
        lastFetchStatus: 'failure',
        lastErrorMessage: errorMessage(error),
      };
      throw error;
    }
  }

  snapshot(): RemoteConfigProviderSnapshot {
    return { ...this.metadata };
  }

  private async fetchWithDependencies(
    dependencies: FirebaseRemoteConfigProviderDependencies,
  ): Promise<Record<string, unknown>> {
    const app = dependencies.getFirebaseApp();
    if (app === null) throw new Error('Firebase app is unavailable');
    if (!await dependencies.isSupported()) throw new Error('Firebase Remote Config is unsupported');

    const remoteConfig = dependencies.getRemoteConfig(app);
    remoteConfig.defaultConfig = firebaseDefaultConfig();
    const isDev = dependencies.isDev();
    remoteConfig.settings.minimumFetchIntervalMillis = isDev
      ? devFetchIntervalMs
      : prodFetchIntervalMs;
    remoteConfig.settings.fetchTimeoutMillis = isDev
      ? devFetchTimeoutMs
      : prodFetchTimeoutMs;

    // Firebase exposes activated cached values only after initialization. Read
    // them even when the subsequent network fetch fails.
    await dependencies.ensureInitialized(remoteConfig);

    let fetchError: unknown = null;
    try {
      await dependencies.fetchAndActivate(remoteConfig);
    } catch (error) {
      fetchError = error;
    }

    const raw: Record<string, unknown> = {};
    for (const definition of REMOTE_CONFIG_DEFINITIONS) {
      const value = dependencies.getValue(remoteConfig, definition.remoteKey);
      if (value.getSource() === 'remote') raw[definition.remoteKey] = value.asString();
    }

    this.metadata = {
      lastFetchStatus: fetchError === null ? 'success' : 'failure',
      fetchTimeMillis: remoteConfig.fetchTimeMillis,
      lastErrorMessage: fetchError === null ? null : errorMessage(fetchError),
    };
    return raw;
  }
}

export function createFirebaseRemoteConfigProvider(
  dependencies?: FirebaseRemoteConfigProviderDependencies,
): FirebaseRemoteConfigProvider {
  return new FirebaseRemoteConfigProvider(dependencies);
}
