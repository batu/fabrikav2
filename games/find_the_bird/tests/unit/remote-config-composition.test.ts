import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteConfigProvider } from '@fabrikav2/services/remote-config';
import {
  REMOTE_CONFIG_DEFAULTS,
  REMOTE_CONFIG_DEFINITIONS,
  ftdRemoteConfigSchema,
} from '../../src/config/remoteConfigSchema';
import {
  configureRemoteConfigService,
  createFtdRemoteConfigService,
  remoteConfigService,
  type RemoteConfigProviderMetadata,
} from '../../src/config/RemoteConfigService';
import {
  createFirebaseRemoteConfigProvider,
  type FirebaseRemoteConfigProviderDependencies,
} from '../../src/config/FirebaseRemoteConfigProvider';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('FTD remote-config schema parity', () => {
  it('preserves every existing key, default, wire key, primitive type, description, and validation rule', () => {
    expect(Object.keys(ftdRemoteConfigSchema)).toEqual(Object.keys(REMOTE_CONFIG_DEFAULTS));

    for (const definition of REMOTE_CONFIG_DEFINITIONS) {
      const field = ftdRemoteConfigSchema[definition.key];
      expect(field).toMatchObject({
        default: REMOTE_CONFIG_DEFAULTS[definition.key],
        remoteKey: definition.remoteKey,
        type: definition.type,
        description: definition.description,
      });

      if (definition.type === 'number') {
        expect(field.validate?.(0 as never)).toBe(true);
        expect(field.validate?.(-1 as never)).toBe(false);
        expect(field.validate?.(1.5 as never)).toBe(false);
      } else if (definition.type === 'string') {
        expect(field.validate?.('value' as never)).toBe(true);
        expect(field.validate?.('   ' as never)).toBe(false);
      } else {
        expect(field.validate).toBeUndefined();
      }
    }
  });
});

describe('FTD shared remote-config compatibility service', () => {
  it('uses static defaults on web and preserves all init/value/snapshot aliases', async () => {
    const service = createFtdRemoteConfigService();

    service.init();
    await service.initAndWait();
    await service.initAndWaitForTest();

    expect(service.value('rewardProgressGoal')).toBe(REMOTE_CONFIG_DEFAULTS.rewardProgressGoal);
    expect(service.snapshot()).toMatchObject({
      state: 'local-only',
      defaults: REMOTE_CONFIG_DEFAULTS,
      active: REMOTE_CONFIG_DEFAULTS,
      lastFetchStatus: 'unavailable',
      fetchTimeMillis: -1,
      lastErrorMessage: null,
    });
    expect(new Set(Object.values(service.snapshot().sources))).toEqual(new Set(['default']));
  });

  it('does not touch browser storage when window is unavailable', () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');

    try {
      const service = createFtdRemoteConfigService();
      expect(service.value('rewardProgressGoal')).toBe(REMOTE_CONFIG_DEFAULTS.rewardProgressGoal);
    } finally {
      if (previousWindow !== undefined) {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: previousWindow,
        });
      }
      if (previousDocument !== undefined) {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: previousDocument,
        });
      }
    }
  });

  it('accepts valid remote values and falls back for absent, wrong, or invalid values', async () => {
    const provider: RemoteConfigProvider = {
      fetch: vi.fn(async () => ({
        reward_progress_goal: '8',
        reward_hints_amount: '-2',
        gameplay_initial_hints: 'not-a-number',
        no_ads_visible: 'false',
        no_ads_product_id: '   ',
      })),
    };
    const service = createFtdRemoteConfigService(provider);

    await service.initAndWait();

    expect(service.value('rewardProgressGoal')).toBe(8);
    expect(service.value('rewardHintsAmount')).toBe(REMOTE_CONFIG_DEFAULTS.rewardHintsAmount);
    expect(service.value('gameplayInitialHints')).toBe(REMOTE_CONFIG_DEFAULTS.gameplayInitialHints);
    expect(service.value('noAdsVisible')).toBe(false);
    expect(service.value('noAdsProductId')).toBe(REMOTE_CONFIG_DEFAULTS.noAdsProductId);
    expect(service.snapshot().sources).toMatchObject({
      rewardProgressGoal: 'remote',
      rewardHintsAmount: 'default',
      gameplayInitialHints: 'default',
      noAdsVisible: 'remote',
      noAdsProductId: 'default',
    });
  });

  it('keeps cached remote values active while compatibility metadata reports a failed fetch', async () => {
    const provider: RemoteConfigProvider = {
      fetch: vi.fn(async () => ({ reward_progress_goal: '11' })),
    };
    const metadata: RemoteConfigProviderMetadata = {
      snapshot: () => ({
        lastFetchStatus: 'failure',
        fetchTimeMillis: 123,
        lastErrorMessage: 'offline',
      }),
    };
    const service = createFtdRemoteConfigService(provider, metadata);

    await service.initAndWait();

    expect(service.value('rewardProgressGoal')).toBe(11);
    expect(service.snapshot()).toMatchObject({
      state: 'fetch-failed',
      lastFetchStatus: 'failure',
      fetchTimeMillis: 123,
      lastErrorMessage: 'offline',
    });
  });

  it('applies development localStorage and test overrides with local precedence and safe snapshots', () => {
    vi.stubEnv('DEV', true);
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn(() => JSON.stringify({ rewardProgressGoal: 9 })),
        },
      },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {},
    });

    try {
      const service = createFtdRemoteConfigService({
        fetch: async () => ({ reward_progress_goal: '8' }),
      });
      service.setValuesForTest({ rewardHintsAmount: 7 });

      expect(service.value('rewardProgressGoal')).toBe(9);
      expect(service.value('rewardHintsAmount')).toBe(7);
      expect(service.snapshot().sources).toMatchObject({
        rewardProgressGoal: 'local',
        rewardHintsAmount: 'local',
      });
    } finally {
      if (previousWindow === undefined) {
        Reflect.deleteProperty(globalThis, 'window');
      } else {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: previousWindow,
        });
      }
      if (previousDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document');
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: previousDocument,
        });
      }
    }
  });

  it('repoints the stable compatibility singleton without changing its object identity', async () => {
    const identity = remoteConfigService;
    const configured = createFtdRemoteConfigService({
      fetch: async () => ({ reward_progress_goal: '13' }),
    });

    configureRemoteConfigService(configured);
    await remoteConfigService.initAndWait();

    expect(remoteConfigService).toBe(identity);
    expect(remoteConfigService.value('rewardProgressGoal')).toBe(13);
  });
});

describe('Firebase remote-config provider', () => {
  it('initializes cached values before fetch and returns them when the network refresh fails', async () => {
    const calls: string[] = [];
    const remoteConfig = {
      defaultConfig: {} as Record<string, boolean | number | string>,
      settings: { minimumFetchIntervalMillis: 0, fetchTimeoutMillis: 0 },
      lastFetchStatus: 'failure',
      fetchTimeMillis: 456,
    };
    const dependencies: FirebaseRemoteConfigProviderDependencies = {
      isDev: () => true,
      getFirebaseApp: () => ({ name: 'test-app' }),
      isSupported: async () => true,
      getRemoteConfig: () => remoteConfig,
      ensureInitialized: async () => {
        calls.push('ensure');
      },
      fetchAndActivate: async () => {
        calls.push('fetch');
        throw new Error('offline');
      },
      getValue: (_config, remoteKey) => ({
        asString: () => remoteKey === 'reward_progress_goal' ? '12' : '',
        getSource: () => remoteKey === 'reward_progress_goal' ? 'remote' : 'default',
      }),
    };
    const provider = createFirebaseRemoteConfigProvider(dependencies);

    await expect(provider.fetch()).resolves.toMatchObject({ reward_progress_goal: '12' });
    expect(calls).toEqual(['ensure', 'fetch']);
    expect(remoteConfig.settings).toEqual({
      minimumFetchIntervalMillis: 60_000,
      fetchTimeoutMillis: 10_000,
    });
    expect(provider.snapshot()).toEqual({
      lastFetchStatus: 'failure',
      fetchTimeMillis: 456,
      lastErrorMessage: 'offline',
    });
  });

  it('fails before reading values when Firebase is unsupported', async () => {
    const getValue = vi.fn();
    const dependencies: FirebaseRemoteConfigProviderDependencies = {
      isDev: () => false,
      getFirebaseApp: () => ({ name: 'test-app' }),
      isSupported: async () => false,
      getRemoteConfig: vi.fn(),
      ensureInitialized: vi.fn(),
      fetchAndActivate: vi.fn(),
      getValue,
    };
    const provider = createFirebaseRemoteConfigProvider(dependencies);

    await expect(provider.fetch()).rejects.toThrow('unsupported');
    expect(getValue).not.toHaveBeenCalled();
  });

  it('uses production fetch settings after a successful activation', async () => {
    const remoteConfig = {
      defaultConfig: {} as Record<string, boolean | number | string>,
      settings: { minimumFetchIntervalMillis: 0, fetchTimeoutMillis: 0 },
      lastFetchStatus: 'success',
      fetchTimeMillis: 789,
    };
    const dependencies: FirebaseRemoteConfigProviderDependencies = {
      isDev: () => false,
      getFirebaseApp: () => ({ name: 'test-app' }),
      isSupported: async () => true,
      getRemoteConfig: () => remoteConfig,
      ensureInitialized: vi.fn(async () => undefined),
      fetchAndActivate: vi.fn(async () => true),
      getValue: (_config, remoteKey) => ({
        asString: () => remoteKey === 'hint_rw_enabled' ? 'false' : '',
        getSource: () => remoteKey === 'hint_rw_enabled' ? 'remote' : 'default',
      }),
    };
    const provider = createFirebaseRemoteConfigProvider(dependencies);

    await expect(provider.fetch()).resolves.toMatchObject({ hint_rw_enabled: 'false' });
    expect(remoteConfig.settings).toEqual({
      minimumFetchIntervalMillis: 43_200_000,
      fetchTimeoutMillis: 5_000,
    });
    expect(provider.snapshot().lastFetchStatus).toBe('success');
  });
});
