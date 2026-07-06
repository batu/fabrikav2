import { describe, expect, it, vi } from 'vitest';

// `@capacitor/core` is an OPTIONAL, un-installed peer dependency in this
// monorepo (see package.json + capacitor-shims.d.ts). These tests always
// pass `platform` explicitly and inject their own providers, but importing
// AttributionService/AdjustAttributionProvider still pulls the top-level
// `Capacitor` read and `registerPlugin` call, so a module factory stands in
// for the absent native bridge at load time.
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({}),
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false },
}));

import { AdjustAttributionProvider } from './AdjustAttributionProvider.ts';
import { createAttributionProvider, AttributionService } from './AttributionService.ts';
import type { AdjustIosConfig } from './AdjustConfig.ts';
import type { AttributionEventName, AttributionPrimitive, AttributionProvider } from './AttributionProvider.ts';
import { DisabledAttributionProvider } from './DisabledAttributionProvider.ts';

const config: AdjustIosConfig = {
  appToken: 'abc123abc123',
  environment: 'production',
  verboseLogging: false,
  eventTokens: {
    appOpen: 'app-open-token',
    levelStart: 'level-start-token',
    levelComplete: 'level-complete-token',
    levelFailed: 'level-failed-token',
    rewardedWatched: 'rewarded-token',
  },
  privacy: {
    disableIdfaReading: true,
    disableAppTrackingTransparencyUsage: true,
  },
};

describe('createAttributionProvider', (): void => {
  it('creates an Adjust provider for iOS when config is enabled', (): void => {
    const adjustProvider = makeProvider('adjust');
    const disabledProvider = makeProvider('disabled');
    const provider = createAttributionProvider(
      'ios',
      {
        enabled: true,
        config,
      },
      {
        createAdjustProvider: vi.fn((): AttributionProvider => adjustProvider),
        createDisabledProvider: vi.fn((): AttributionProvider => disabledProvider),
      },
    );

    expect(provider).toBe(adjustProvider);
  });

  it('uses the default Adjust provider factory for enabled iOS config', (): void => {
    const provider = createAttributionProvider('ios', {
      enabled: true,
      config,
    });

    expect(provider).toBeInstanceOf(AdjustAttributionProvider);
    expect(provider.providerName).toBe('adjust-ios');
  });

  it('uses the default disabled provider factory off iOS and for disabled iOS config', (): void => {
    const androidProvider = createAttributionProvider('android', { enabled: true, config });
    const disabledIosProvider = createAttributionProvider('ios', {
      enabled: false,
      reason: 'missing Adjust iOS config: token',
      missingKeys: ['token'],
    });

    expect(androidProvider).toBeInstanceOf(DisabledAttributionProvider);
    expect(androidProvider.providerName).toBe('disabled');
    expect(disabledIosProvider).toBeInstanceOf(DisabledAttributionProvider);
    expect(disabledIosProvider.providerName).toBe('disabled');
  });

  it('creates disabled providers for non-iOS platforms and disabled config', (): void => {
    const reasons: string[] = [];
    const factories = {
      createAdjustProvider: vi.fn((): AttributionProvider => makeProvider('adjust')),
      createDisabledProvider: vi.fn((reason: string): AttributionProvider => {
        reasons.push(reason);
        return makeProvider('disabled');
      }),
    };

    createAttributionProvider('android', { enabled: true, config }, factories);
    createAttributionProvider('web', { enabled: true, config }, factories);
    createAttributionProvider('', { enabled: true, config }, factories);
    createAttributionProvider(
      'ios',
      {
        enabled: false,
        reason: 'missing Adjust iOS config: token',
        missingKeys: ['token'],
      },
      factories,
    );

    expect(reasons).toEqual([
      'Adjust disabled on android platform',
      'Adjust disabled on web platform',
      'Adjust disabled on web platform',
      'iOS Adjust unavailable: missing Adjust iOS config: token',
    ]);
    expect(factories.createAdjustProvider).not.toHaveBeenCalled();
  });
});

describe('AttributionService', (): void => {
  it('runs a disabled provider reason exactly once across init and track calls', async (): Promise<void> => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const provider = createAttributionProvider(
      'android',
      { enabled: true, config },
      {
        createAdjustProvider: vi.fn((): AttributionProvider => makeProvider('adjust')),
        createDisabledProvider: (reason: string): AttributionProvider =>
          new DisabledAttributionProvider(reason, logger),
      },
    );
    const service = new AttributionService(provider);

    await service.init();
    await service.levelStart({ level_id: '1' });
    await service.levelComplete({ level_id: '1' });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('[attribution:disabled] Adjust disabled on android platform');
  });

  it('warns and still tracks when the startup gate rejects', async (): Promise<void> => {
    const provider = makeProvider('provider');
    const logger = {
      warn: vi.fn(),
    };
    const service = new AttributionService(provider, {
      startupGate: Promise.reject(new Error('startup failed')),
      logger,
    });

    await service.levelStart({ level_id: '1' });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(provider.track).toHaveBeenCalledWith('levelStart', { level_id: '1' });
  });

  it('warns and still tracks when the startup gate never settles', async (): Promise<void> => {
    vi.useFakeTimers();
    const provider = makeProvider('provider');
    const logger = {
      warn: vi.fn(),
    };
    const service = new AttributionService(provider, {
      startupGate: new Promise((): void => {}),
      startupGateTimeoutMs: 10,
      logger,
    });

    const track = service.levelStart({ level_id: '1' });
    await vi.advanceTimersByTimeAsync(10);
    await track;
    vi.useRealTimers();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(provider.track).toHaveBeenCalledWith('levelStart', { level_id: '1' });
  });

  it('tracks immediately when no startup gate is configured', async (): Promise<void> => {
    const provider = makeProvider('provider');
    const service = new AttributionService(provider);

    await service.levelStart({ level_id: '1' });

    expect(provider.track).toHaveBeenCalledWith('levelStart', { level_id: '1' });
  });

  it('warns once for disabled iOS config', async (): Promise<void> => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const provider = createAttributionProvider(
      'ios',
      {
        enabled: false,
        reason: 'missing Adjust iOS config: token',
        missingKeys: ['token'],
      },
      {
        createAdjustProvider: vi.fn((): AttributionProvider => makeProvider('adjust')),
        createDisabledProvider: (reason: string): AttributionProvider =>
          new DisabledAttributionProvider(reason, logger),
      },
    );
    const service = new AttributionService(provider);

    await service.init();
    await service.levelStart({ level_id: '1' });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[attribution:disabled] iOS Adjust unavailable: missing Adjust iOS config: token',
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('forwards each named method to the provider with generic params bags', async (): Promise<void> => {
    interface LevelFailedParams {
      level_id: string;
      attempts: number;
      skipped_hint: boolean;
    }

    const provider = makeProvider('provider');
    const service = new AttributionService(provider);
    const levelFailedParams: LevelFailedParams = {
      level_id: '3',
      attempts: 2,
      skipped_hint: false,
    };

    await service.appOpen({ cohort_bucket: 4 });
    await service.levelStart({ level_id: '1', display_name: 'First Level' });
    await service.levelComplete({ level_id: '2', elapsed_seconds: 12 });
    await service.levelFailed(levelFailedParams);
    await service.rewardedWatched({ placement: 'hint_button' });

    expect(provider.track).toHaveBeenNthCalledWith(1, 'appOpen', { cohort_bucket: 4 });
    expect(provider.track).toHaveBeenNthCalledWith(2, 'levelStart', {
      level_id: '1',
      display_name: 'First Level',
    });
    expect(provider.track).toHaveBeenNthCalledWith(3, 'levelComplete', {
      level_id: '2',
      elapsed_seconds: 12,
    });
    expect(provider.track).toHaveBeenNthCalledWith(4, 'levelFailed', levelFailedParams);
    expect(provider.track).toHaveBeenNthCalledWith(5, 'rewardedWatched', {
      placement: 'hint_button',
    });
  });

  it('allows direct provider calls with interface-shaped params bags', async (): Promise<void> => {
    interface LevelFailedParams {
      level_id: string;
      attempts: number;
      skipped_hint: boolean;
    }

    const provider = makeProvider('provider');
    const params: LevelFailedParams = {
      level_id: '3',
      attempts: 2,
      skipped_hint: false,
    };

    await provider.track('levelFailed', params);

    expect(provider.track).toHaveBeenCalledWith('levelFailed', params);
  });
});

function makeProvider(providerName: string): AttributionProvider {
  return {
    providerName,
    init: vi.fn(async (): Promise<void> => {}),
    track: vi.fn(async <P extends { [K in keyof P]: AttributionPrimitive }>(
      _eventName: AttributionEventName,
      _params?: P,
    ): Promise<void> => {}),
  };
}
