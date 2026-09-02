import { describe, expect, it, vi } from 'vitest';
import type { AppsFlyerAttributionPlugin } from './AppsFlyerAttributionPlugin.ts';
import { AppsFlyerAttributionProvider } from './AppsFlyerAttributionProvider.ts';
import type { AppsFlyerConfig } from './AppsFlyerConfig.ts';

const config: AppsFlyerConfig = {
  devKey: 'fZvuk792H9hJQKmaTwuXxA',
  appleAppId: '6793860059',
  debugLogging: false,
  sharingPartners: [],
};

function makePlugin(overrides: Partial<AppsFlyerAttributionPlugin> = {}): AppsFlyerAttributionPlugin {
  return {
    initialize: vi.fn(async () => ({ initialized: true })),
    trackEvent: vi.fn(async () => ({ tracked: true })),
    getStatus: vi.fn(async () => ({ initialized: true, appsFlyerId: 'af-id' })),
    ...overrides,
  };
}

const silentLogger = { info: vi.fn(), warn: vi.fn() };

describe('AppsFlyerAttributionProvider', (): void => {
  it('initializes once and passes redacted-free native options', async (): Promise<void> => {
    const plugin = makePlugin();
    const provider = new AppsFlyerAttributionProvider(config, { plugin, logger: silentLogger });

    await provider.init();
    await provider.init();

    expect(plugin.initialize).toHaveBeenCalledTimes(1);
    expect(plugin.initialize).toHaveBeenCalledWith({
      devKey: config.devKey,
      appleAppId: config.appleAppId,
      debugLogging: false,
      sharingPartners: [],
    });
  });

  it('never logs the full dev key', async (): Promise<void> => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const provider = new AppsFlyerAttributionProvider(config, { plugin: makePlugin(), logger });

    await provider.init();

    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain(config.devKey);
  });

  it('drops legacy raw events and sends only mapper-confirmed events', async (): Promise<void> => {
    const plugin = makePlugin();
    const provider = new AppsFlyerAttributionProvider(config, { plugin, logger: silentLogger });

    await provider.track('levelComplete', { level_name: 'private free form' });
    expect(plugin.trackEvent).not.toHaveBeenCalled();

    await expect(provider.trackConfirmed('af_level_achieved', { af_level: '3' })).resolves.toBe(true);
    expect(plugin.trackEvent).toHaveBeenCalledWith({ eventName: 'af_level_achieved', eventValues: { af_level: '3' } });
  });

  it('permanently disables on non-timeout init failure and stops calling native', async (): Promise<void> => {
    const plugin = makePlugin({
      initialize: vi.fn(async () => {
        throw new Error('bridge missing');
      }),
    });
    const provider = new AppsFlyerAttributionProvider(config, { plugin, logger: silentLogger });

    await provider.init();
    await provider.track('appOpen');

    expect(plugin.initialize).toHaveBeenCalledTimes(1);
    expect(plugin.trackEvent).not.toHaveBeenCalled();
  });

  it('reports mapped track failures without throwing', async (): Promise<void> => {
    const plugin = makePlugin({
      trackEvent: vi.fn(async () => {
        throw new Error('native down');
      }),
    });
    const provider = new AppsFlyerAttributionProvider(config, { plugin, logger: silentLogger });

    await expect(provider.trackConfirmed('af_ad_revenue', { af_revenue: '1' })).resolves.toBe(false);
  });

  it('does not initialize when init resolves uninitialized', async (): Promise<void> => {
    const plugin = makePlugin({ initialize: vi.fn(async () => ({ initialized: false })) });
    const provider = new AppsFlyerAttributionProvider(config, { plugin, logger: silentLogger });

    await provider.init();
    await provider.track('appOpen');

    expect(plugin.trackEvent).not.toHaveBeenCalled();
  });
});
