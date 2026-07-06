import { describe, expect, it } from 'vitest';
import { booleanField, numberField, stringField, type ConfigSchema } from './schema.ts';
import { createRemoteConfigService, type RemoteConfigProvider } from './service.ts';

const schema = {
  interstitialEveryNLevels: numberField(3, { remoteKey: 'interstitial_every_n_levels', validate: (v) => v >= 0 }),
  hintRwEnabled: booleanField(true, { remoteKey: 'hint_rw_enabled' }),
  noAdsProductId: stringField('com.example.noads', { remoteKey: 'no_ads_product_id', validate: (v) => v.trim().length > 0 }),
} satisfies ConfigSchema;

function provider(values: Record<string, unknown>): RemoteConfigProvider {
  return { fetch: async () => values };
}

describe('remote-config service', (): void => {
  it('returns declared defaults before any refresh (local-only)', (): void => {
    const service = createRemoteConfigService(schema);
    expect(service.state).toBe('local-only');
    expect(service.value('interstitialEveryNLevels')).toBe(3);
    expect(service.value('hintRwEnabled')).toBe(true);
    expect(service.value('noAdsProductId')).toBe('com.example.noads');
  });

  it('activates valid remote values keyed by remoteKey after refresh', async (): Promise<void> => {
    const service = createRemoteConfigService(schema, {
      provider: provider({
        interstitial_every_n_levels: '5',
        hint_rw_enabled: false,
        no_ads_product_id: 'com.marble.noads',
      }),
      now: () => 1_234,
    });

    await service.refresh();

    expect(service.state).toBe('ready');
    expect(service.value('interstitialEveryNLevels')).toBe(5);
    expect(service.value('hintRwEnabled')).toBe(false);
    expect(service.value('noAdsProductId')).toBe('com.marble.noads');

    const snap = service.snapshot();
    expect(snap.lastFetchAtMs).toBe(1_234);
    expect(snap.origins).toEqual({
      interstitialEveryNLevels: 'remote',
      hintRwEnabled: 'remote',
      noAdsProductId: 'remote',
    });
  });

  it('falls back to the default for absent, wrong-type, and failed-validate remote values', async (): Promise<void> => {
    const service = createRemoteConfigService(schema, {
      provider: provider({
        // interstitial_every_n_levels absent → default 3
        hint_rw_enabled: 'not-a-boolean', // wrong type → default true
        no_ads_product_id: '   ', // fails validate (non-empty) → default
      }),
    });

    await service.refresh();

    expect(service.value('interstitialEveryNLevels')).toBe(3);
    expect(service.value('hintRwEnabled')).toBe(true);
    expect(service.value('noAdsProductId')).toBe('com.example.noads');
    expect(service.snapshot().origins).toEqual({
      interstitialEveryNLevels: 'default',
      hintRwEnabled: 'default',
      noAdsProductId: 'default',
    });
  });

  it('rejects an out-of-range remote number via the field validate', async (): Promise<void> => {
    const service = createRemoteConfigService(schema, {
      provider: provider({ interstitial_every_n_levels: -2 }),
    });

    await service.refresh();

    expect(service.value('interstitialEveryNLevels')).toBe(3);
    expect(service.snapshot().origins.interstitialEveryNLevels).toBe('default');
  });

  it('keeps last good values when a later refresh fails', async (): Promise<void> => {
    let call = 0;
    const flakyProvider: RemoteConfigProvider = {
      fetch: async () => {
        call += 1;
        if (call === 1) return { interstitial_every_n_levels: 7 };
        throw new Error('network down');
      },
    };
    const service = createRemoteConfigService(schema, { provider: flakyProvider });

    await service.refresh();
    expect(service.value('interstitialEveryNLevels')).toBe(7);

    await service.refresh();
    expect(service.state).toBe('fetch-failed');
    // last good value survives the failed refresh (not reverted to default 3)
    expect(service.value('interstitialEveryNLevels')).toBe(7);
    expect(service.snapshot().lastErrorMessage).toBe('network down');
  });

  it('stays on defaults with no provider configured', async (): Promise<void> => {
    const service = createRemoteConfigService(schema);
    await service.refresh();
    expect(service.state).toBe('local-only');
    expect(service.value('interstitialEveryNLevels')).toBe(3);
  });
});
