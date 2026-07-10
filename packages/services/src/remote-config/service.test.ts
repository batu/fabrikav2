import { describe, expect, it } from 'vitest';
import { booleanField, numberField, stringField, type ConfigSchema } from './schema.ts';
import {
  createRemoteConfigService,
  type RemoteConfigProvider,
} from './service.ts';

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

  it('preserves the original service surface without a required lifecycle API', (): void => {
    const service = createRemoteConfigService(schema);

    expect(service).not.toHaveProperty('dispose');
  });

  describe('overlapping refreshes (stale-refresh guard)', (): void => {
    // A provider whose fetches are settled by the test, so we can drive the
    // completion order of two concurrent refreshes independently of start order.
    function deferredProvider(): {
      provider: RemoteConfigProvider;
      settle: (values: Record<string, unknown>) => void;
      reject: (err: unknown) => void;
    } {
      const gate: {
        resolve?: (values: Record<string, unknown>) => void;
        reject?: (err: unknown) => void;
      } = {};
      const provider: RemoteConfigProvider = {
        fetch: () =>
          new Promise<Record<string, unknown>>((resolve, reject) => {
            gate.resolve = resolve;
            gate.reject = reject;
          }),
      };
      return {
        provider,
        settle: (values) => gate.resolve?.(values),
        reject: (err) => gate.reject?.(err),
      };
    }

    it('older success settling last does not overwrite the newer success', async (): Promise<void> => {
      // Two independent in-flight fetches: the first-started (older) resolves
      // AFTER the second-started (newer). Newer must win.
      const a = deferredProvider();
      const b = deferredProvider();
      let call = 0;
      const provider: RemoteConfigProvider = {
        fetch: () => (call++ === 0 ? a.provider.fetch() : b.provider.fetch()),
      };
      const service = createRemoteConfigService(schema, { provider });

      const first = service.refresh(); // older, gen 1
      const second = service.refresh(); // newer, gen 2

      b.settle({ interstitial_every_n_levels: 9 }); // newer completes first
      await second;
      expect(service.value('interstitialEveryNLevels')).toBe(9);

      a.settle({ interstitial_every_n_levels: 1 }); // older completes late
      await first;
      // Older completion is discarded — newer value survives.
      expect(service.value('interstitialEveryNLevels')).toBe(9);
      expect(service.state).toBe('ready');
    });

    it('older failure settling last does not clear the newer success', async (): Promise<void> => {
      const a = deferredProvider();
      const b = deferredProvider();
      let call = 0;
      const provider: RemoteConfigProvider = {
        fetch: () => (call++ === 0 ? a.provider.fetch() : b.provider.fetch()),
      };
      const service = createRemoteConfigService(schema, { provider });

      const first = service.refresh(); // older, gen 1
      const second = service.refresh(); // newer, gen 2

      b.settle({ interstitial_every_n_levels: 9 });
      await second;

      a.reject(new Error('older network down'));
      await first;
      // Newer success is not cleared to fetch-failed by the stale rejection.
      expect(service.state).toBe('ready');
      expect(service.value('interstitialEveryNLevels')).toBe(9);
      expect(service.snapshot().lastErrorMessage).toBeNull();
    });

    it('older success settling last does not clear the newer failure', async (): Promise<void> => {
      const a = deferredProvider();
      const b = deferredProvider();
      let call = 0;
      const provider: RemoteConfigProvider = {
        fetch: () => (call++ === 0 ? a.provider.fetch() : b.provider.fetch()),
      };
      const service = createRemoteConfigService(schema, { provider });

      const first = service.refresh(); // older, gen 1
      const second = service.refresh(); // newer, gen 2

      b.reject(new Error('newer network down')); // newer fails first
      await second;
      expect(service.state).toBe('fetch-failed');

      a.settle({ interstitial_every_n_levels: 1 }); // older succeeds late
      await first;
      // Stale older success is discarded — newer failure state stands.
      expect(service.state).toBe('fetch-failed');
      expect(service.snapshot().lastErrorMessage).toBe('newer network down');
      expect(service.value('interstitialEveryNLevels')).toBe(3);
    });

    it('completion in start order still lets the newer result win', async (): Promise<void> => {
      const a = deferredProvider();
      const b = deferredProvider();
      let call = 0;
      const provider: RemoteConfigProvider = {
        fetch: () => (call++ === 0 ? a.provider.fetch() : b.provider.fetch()),
      };
      const service = createRemoteConfigService(schema, { provider });

      const first = service.refresh(); // older, gen 1
      const second = service.refresh(); // newer, gen 2

      a.settle({ interstitial_every_n_levels: 1 }); // older completes first
      await first;
      // Settling a stale generation cannot commit state while the newest call
      // is still pending.
      expect(service.state).toBe('fetching');
      expect(service.value('interstitialEveryNLevels')).toBe(3);
      expect(service.snapshot().lastFetchAtMs).toBeNull();

      b.settle({ interstitial_every_n_levels: 9 }); // newer completes last
      await second;

      expect(service.value('interstitialEveryNLevels')).toBe(9);
      expect(service.state).toBe('ready');
    });

    it('does not let validate() reentrancy commit the superseded generation', async (): Promise<void> => {
      const newer = deferredProvider();
      let fetchCount = 0;
      let startNewerRefresh: (() => void) | undefined;
      let newerRefresh: Promise<void> | undefined;
      const reentrantSchema = {
        value: numberField(0, {
          validate: () => {
            startNewerRefresh?.();
            return true;
          },
        }),
      } satisfies ConfigSchema;
      const provider: RemoteConfigProvider = {
        fetch: () =>
          fetchCount++ === 0 ? Promise.resolve({ value: 1 }) : newer.provider.fetch(),
      };
      const service = createRemoteConfigService(reentrantSchema, { provider });
      startNewerRefresh = () => {
        startNewerRefresh = undefined;
        newerRefresh = service.refresh();
      };

      await service.refresh();

      expect(newerRefresh).toBeDefined();
      expect(service.state).toBe('fetching');
      expect(service.value('value')).toBe(0);
      expect(service.snapshot().origins.value).toBe('default');
      expect(service.snapshot().lastFetchAtMs).toBeNull();

      newer.settle({ value: 2 });
      await newerRefresh;
      expect(service.state).toBe('ready');
      expect(service.value('value')).toBe(2);
    });

    it('does not let a reentrant error message getter commit the superseded catch', async (): Promise<void> => {
      // The older refresh rejects with an error whose message getter starts a
      // newer refresh. The message is read inside the catch; if the stale catch
      // then committed, it would overwrite the newer fetching state.
      const newer = deferredProvider();
      let fetchCount = 0;
      let newerRefresh: Promise<void> | undefined;
      const reentrantSchema = { value: numberField(0) } satisfies ConfigSchema;

      const service = createRemoteConfigService(reentrantSchema, {
        provider: {
          fetch: () => {
            if (fetchCount++ === 0) {
              const err = new Error();
              // Reading .message re-enters refresh() with a newer generation.
              Object.defineProperty(err, 'message', {
                get: (): string => {
                  if (newerRefresh === undefined) newerRefresh = service.refresh();
                  return 'older network down';
                },
              });
              return Promise.reject(err);
            }
            return newer.provider.fetch();
          },
        },
      });

      await service.refresh();

      // The stale older catch must not have committed fetch-failed over the
      // newer, still-pending fetch.
      expect(newerRefresh).toBeDefined();
      expect(service.state).toBe('fetching');
      expect(service.snapshot().lastErrorMessage).toBeNull();

      newer.settle({ value: 2 });
      await newerRefresh;
      expect(service.state).toBe('ready');
      expect(service.value('value')).toBe(2);
      expect(service.snapshot().lastErrorMessage).toBeNull();
    });

    it('does not let now() reentrancy partially commit the superseded generation', async (): Promise<void> => {
      const newer = deferredProvider();
      let fetchCount = 0;
      let startNewer = true;
      let newerRefresh: Promise<void> | undefined;
      const reentrantSchema = { value: numberField(0) } satisfies ConfigSchema;
      const provider: RemoteConfigProvider = {
        fetch: () =>
          fetchCount++ === 0 ? Promise.resolve({ value: 1 }) : newer.provider.fetch(),
      };
      const service = createRemoteConfigService(reentrantSchema, {
        provider,
        now: () => {
          if (startNewer) {
            startNewer = false;
            newerRefresh = service.refresh();
          }
          return 1_234;
        },
      });

      await service.refresh();

      expect(newerRefresh).toBeDefined();
      expect(service.state).toBe('fetching');
      expect(service.value('value')).toBe(0);
      expect(service.snapshot().origins.value).toBe('default');
      expect(service.snapshot().lastFetchAtMs).toBeNull();

      newer.settle({ value: 2 });
      await newerRefresh;
      expect(service.state).toBe('ready');
      expect(service.value('value')).toBe(2);
      expect(service.snapshot().lastFetchAtMs).toBe(1_234);
    });
  });
});
