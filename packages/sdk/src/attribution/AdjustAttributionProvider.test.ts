import { afterEach, describe, expect, it, vi } from 'vitest';

// `@capacitor/core` is an OPTIONAL, un-installed peer dependency in this
// monorepo (see package.json + capacitor-shims.d.ts). These tests exercise
// the provider through its injected `plugin` seam, but importing the module
// still pulls the top-level `registerPlugin('AdjustAttribution')` call, so a
// module factory must stand in for the absent native bridge at load time.
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({}),
}));

import { AdjustAttributionProvider } from './AdjustAttributionProvider.ts';
import type { AdjustAttributionPlugin } from './AdjustAttributionPlugin.ts';
import type { AdjustIosConfig } from './AdjustConfig.ts';

const config: AdjustIosConfig = {
  appToken: 'abc123abc123',
  environment: 'sandbox',
  verboseLogging: false,
  eventTokens: {
    appOpen: null,
    levelStart: null,
    levelComplete: 'level-complete-token',
    levelFailed: null,
    rewardedWatched: 'rewarded-token',
  },
  privacy: {
    disableIdfaReading: true,
    disableAppTrackingTransparencyUsage: true,
  },
};

describe('AdjustAttributionProvider', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('deduplicates concurrent initialization', async (): Promise<void> => {
    let resolveInit: ((value: { initialized: boolean }) => void) = (): void => {};
    const plugin = makePlugin({
      initialize: vi.fn(
        (): Promise<{ initialized: boolean }> =>
          new Promise((resolve): void => {
            resolveInit = resolve;
          }),
      ),
    });
    const provider = makeProvider(plugin);

    const firstInit = provider.init();
    const secondInit = provider.init();

    expect(plugin.initialize).toHaveBeenCalledTimes(1);
    resolveInit({ initialized: true });
    await Promise.all([firstInit, secondInit]);
  });

  it('initializes with configured event tokens and the no-IDFA/no-ATT privacy stance', async (): Promise<void> => {
    const plugin = makePlugin();
    const provider = makeProvider(plugin);

    await provider.init();

    expect(plugin.initialize).toHaveBeenCalledWith({
      appToken: 'abc123abc123',
      environment: 'sandbox',
      verboseLogging: false,
      disableIdfaReading: true,
      disableAppTrackingTransparencyUsage: true,
      eventTokens: {
        levelComplete: 'level-complete-token',
        rewardedWatched: 'rewarded-token',
      },
    });
  });

  it('redacts app tokens in initialization logs', async (): Promise<void> => {
    const plugin = makePlugin();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const provider = new AdjustAttributionProvider(config, {
      plugin,
      logger,
      timeoutMs: {
        init: 10,
        track: 10,
      },
    });

    await provider.init();

    const loggedPayloads = logger.info.mock.calls.flatMap((call) => call);
    expect(JSON.stringify(loggedPayloads)).not.toContain(config.appToken);
    expect(JSON.stringify(loggedPayloads)).toContain('<redacted:c123>');
  });

  it('skips events whose token is not configured', async (): Promise<void> => {
    const plugin = makePlugin();
    const provider = makeProvider(plugin);

    await provider.track('levelStart', { level_id: '1', level_name: 'Level 1' });

    expect(plugin.initialize).toHaveBeenCalledTimes(1);
    expect(plugin.trackEvent).not.toHaveBeenCalled();
  });

  it('tracks configured events with stringified callback params', async (): Promise<void> => {
    interface LevelCompleteParams {
      level_id: string;
      time_seconds: number;
      hints_used: number;
      wrong_taps: number;
      ignored: null;
      alsoIgnored: undefined;
    }

    const plugin = makePlugin();
    const provider = makeProvider(plugin);
    const params: LevelCompleteParams = {
      level_id: '1',
      time_seconds: 12,
      hints_used: 0,
      wrong_taps: 2,
      ignored: null,
      alsoIgnored: undefined,
    };

    await provider.track('levelComplete', params);

    expect(plugin.trackEvent).toHaveBeenCalledWith({
      eventName: 'levelComplete',
      callbackParameters: {
        level_id: '1',
        time_seconds: '12',
        hints_used: '0',
        wrong_taps: '2',
      },
    });
  });

  it('permanently disables the provider when native init rejects', async (): Promise<void> => {
    const plugin = makePlugin({
      initialize: vi.fn(async (): Promise<{ initialized: boolean }> => {
        throw new Error('native init failed');
      }),
    });
    const provider = makeProvider(plugin);

    await provider.track('levelComplete', { level_id: '1' });
    await provider.track('levelComplete', { level_id: '1' });

    expect(plugin.initialize).toHaveBeenCalledTimes(1);
    expect(plugin.trackEvent).not.toHaveBeenCalled();
  });

  it('does not retry native initialization after native returns disabled', async (): Promise<void> => {
    const plugin = makePlugin({
      initialize: vi.fn(async (): Promise<{ initialized: boolean }> => ({ initialized: false })),
    });
    const provider = makeProvider(plugin);

    await provider.track('levelComplete', { level_id: '1' });
    await provider.track('levelComplete', { level_id: '1' });

    expect(plugin.initialize).toHaveBeenCalledTimes(1);
    expect(plugin.trackEvent).not.toHaveBeenCalled();
  });

  it('times out stuck native initialization without permanently disabling the provider', async (): Promise<void> => {
    vi.useFakeTimers();
    const plugin = makePlugin({
      initialize: vi
        .fn<AdjustAttributionPlugin['initialize']>()
        .mockImplementationOnce(
          (): Promise<{ initialized: boolean }> =>
            new Promise((): void => {}),
        )
        .mockResolvedValueOnce({ initialized: true }),
    });
    const provider = makeProvider(plugin);

    const firstTrack = provider.track('levelComplete', { level_id: '1' });
    await vi.advanceTimersByTimeAsync(10);
    await firstTrack;
    await provider.track('levelComplete', { level_id: '1' });

    expect(plugin.initialize).toHaveBeenCalledTimes(2);
    expect(plugin.trackEvent).toHaveBeenCalledTimes(1);
  });

  it('does not permanently disable the provider when native tracking rejects or returns false', async (): Promise<void> => {
    const plugin = makePlugin({
      trackEvent: vi
        .fn<AdjustAttributionPlugin['trackEvent']>()
        .mockRejectedValueOnce(new Error('native track failed'))
        .mockResolvedValueOnce({ tracked: false })
        .mockResolvedValueOnce({ tracked: true }),
    });
    const provider = makeProvider(plugin);

    await provider.track('levelComplete', { level_id: '1' });
    await provider.track('levelComplete', { level_id: '2' });
    await provider.track('levelComplete', { level_id: '3' });

    expect(plugin.initialize).toHaveBeenCalledTimes(1);
    expect(plugin.trackEvent).toHaveBeenCalledTimes(3);
  });

  it('drops stuck native event tracking without rejecting callers', async (): Promise<void> => {
    vi.useFakeTimers();
    const plugin = makePlugin({
      trackEvent: vi.fn(
        (): Promise<{ tracked: boolean }> =>
          new Promise((): void => {}),
      ),
    });
    const provider = makeProvider(plugin);

    const track = provider.track('levelComplete', { level_id: '1' });
    await vi.advanceTimersByTimeAsync(10);

    await expect(track).resolves.toBeUndefined();
    expect(plugin.trackEvent).toHaveBeenCalledTimes(1);
  });
});

function makeProvider(plugin: AdjustAttributionPlugin): AdjustAttributionProvider {
  return new AdjustAttributionProvider(config, {
    plugin,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
    },
    timeoutMs: {
      init: 10,
      track: 10,
    },
  });
}

function makePlugin(overrides: Partial<AdjustAttributionPlugin> = {}): AdjustAttributionPlugin {
  return {
    initialize: vi.fn(async (): Promise<{ initialized: boolean }> => ({ initialized: true })),
    trackEvent: vi.fn(async (): Promise<{ tracked: boolean }> => ({ tracked: true })),
    getStatus: vi.fn(async (): Promise<{ initialized: boolean; environment: string | null }> => ({
      initialized: true,
      environment: 'sandbox',
    })),
    ...overrides,
  };
}
