import { describe, expect, it, vi } from 'vitest';
import type { CapacitorMetaPlugin } from './CapacitorMetaPlugin.ts';
import { CapacitorMetaProvider } from './CapacitorMetaProvider.ts';
import type { MetaConfig } from './MetaConfig.ts';

const config: MetaConfig = {
  appId: '4138472436283342',
  clientToken: 'df7e72e4b37b02ff036dc836d8eea518',
  autoLogAppEvents: false,
  advertiserIdCollection: false,
};

function makePlugin(overrides: Partial<CapacitorMetaPlugin> = {}): CapacitorMetaPlugin {
  return {
    initialize: vi.fn(async () => ({ initialized: true })),
    logEvent: vi.fn(async () => ({ logged: true })),
    setAdvertiserTrackingEnabled: vi.fn(async () => ({ initialized: true })),
    getStatus: vi.fn(async () => ({ initialized: true, appId: config.appId })),
    ...overrides,
  };
}

const silentLogger = { info: vi.fn(), warn: vi.fn() };

describe('CapacitorMetaProvider', (): void => {
  it('initializes once with the full native options', async (): Promise<void> => {
    const plugin = makePlugin();
    const provider = new CapacitorMetaProvider(config, { plugin, logger: silentLogger });

    await provider.init();
    await provider.init();

    expect(plugin.initialize).toHaveBeenCalledTimes(1);
    expect(plugin.initialize).toHaveBeenCalledWith({
      appId: config.appId,
      clientToken: config.clientToken,
      autoLogAppEvents: false,
      advertiserIdCollection: false,
    });
    expect(provider.getStatus()).toEqual({ state: 'initialized' });
  });

  it('never logs the client token', async (): Promise<void> => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const provider = new CapacitorMetaProvider(config, { plugin: makePlugin(), logger });

    await provider.init();

    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(config.clientToken);
  });

  it('reports error status on native init failure and skips later calls', async (): Promise<void> => {
    const plugin = makePlugin({
      initialize: vi.fn(async () => {
        throw new Error('FBSDK missing');
      }),
    });
    const provider = new CapacitorMetaProvider(config, { plugin, logger: silentLogger });

    await provider.init();
    await provider.logEvent('af_level_achieved');
    await provider.setAdvertiserTrackingEnabled(true);

    expect(provider.getStatus()).toEqual({ state: 'error', reason: 'FBSDK missing' });
    expect(plugin.initialize).toHaveBeenCalledTimes(1);
    expect(plugin.logEvent).not.toHaveBeenCalled();
    expect(plugin.setAdvertiserTrackingEnabled).not.toHaveBeenCalled();
  });

  it('logs events with stringified params, dropping null/undefined', async (): Promise<void> => {
    const plugin = makePlugin();
    const provider = new CapacitorMetaProvider(config, { plugin, logger: silentLogger });

    await provider.logEvent('level_complete', { level: 2, perfect: false, empty: null });

    expect(plugin.logEvent).toHaveBeenCalledWith({
      eventName: 'level_complete',
      parameters: { level: '2', perfect: 'false' },
    });
  });

  it('swallows logEvent failures without throwing', async (): Promise<void> => {
    const plugin = makePlugin({
      logEvent: vi.fn(async () => {
        throw new Error('native down');
      }),
    });
    const provider = new CapacitorMetaProvider(config, { plugin, logger: silentLogger });

    await expect(provider.logEvent('purchase')).resolves.toBeUndefined();
  });

  it('forwards advertiser tracking only after successful init', async (): Promise<void> => {
    const plugin = makePlugin();
    const provider = new CapacitorMetaProvider(config, { plugin, logger: silentLogger });

    await provider.setAdvertiserTrackingEnabled(true);
    expect(plugin.setAdvertiserTrackingEnabled).not.toHaveBeenCalled();

    await provider.init();
    await provider.setAdvertiserTrackingEnabled(true);
    expect(plugin.setAdvertiserTrackingEnabled).toHaveBeenCalledWith({ enabled: true });
  });
});
