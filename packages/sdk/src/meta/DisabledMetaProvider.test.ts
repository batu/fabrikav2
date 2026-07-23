import { describe, expect, it, vi } from 'vitest';
import { CapacitorMetaProvider } from './CapacitorMetaProvider.ts';
import { createMetaProvider, DisabledMetaProvider } from './DisabledMetaProvider.ts';

describe('DisabledMetaProvider', (): void => {
  it('reports not-configured status with the reason and logs it once', async (): Promise<void> => {
    const logger = { info: vi.fn() };
    const provider = new DisabledMetaProvider('missing Facebook config: VITE_FB_APP_ID', logger);

    await provider.init();
    await provider.logEvent('anything');
    await provider.setAdvertiserTrackingEnabled(true);

    expect(provider.getStatus()).toEqual({
      state: 'not-configured',
      reason: 'missing Facebook config: VITE_FB_APP_ID',
    });
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});

describe('createMetaProvider', (): void => {
  it('creates the capacitor provider for enabled config', (): void => {
    const provider = createMetaProvider({
      enabled: true,
      config: {
        appId: '4138472436283342',
        clientToken: 'df7e72e4b37b02ff036dc836d8eea518',
        autoLogAppEvents: false,
        advertiserIdCollection: false,
      },
    });

    expect(provider).toBeInstanceOf(CapacitorMetaProvider);
  });

  it('creates a disabled provider carrying the config reason', (): void => {
    const provider = createMetaProvider({
      enabled: false,
      reason: 'VITE_FB_ENABLED is not true',
      missingKeys: [],
    });

    expect(provider).toBeInstanceOf(DisabledMetaProvider);
    expect(provider.getStatus()).toMatchObject({ state: 'not-configured' });
  });
});
