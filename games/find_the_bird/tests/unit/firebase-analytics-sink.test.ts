import { describe, expect, it, vi } from 'vitest';
import { createFirebaseAnalyticsSink } from '../../src/analytics/FirebaseAnalyticsSink';

describe('native Firebase analytics projection', () => {
  it('loads once, preserves events waiting for the plugin, and isolates automatic sessions', async () => {
    const logEvent = vi.fn(async (_options: { name: string; params?: object }) => {});
    let resolve!: (module: { FirebaseAnalytics: { logEvent: typeof logEvent } }) => void;
    const loader = vi.fn(() => new Promise<{ FirebaseAnalytics: { logEvent: typeof logEvent } }>((done) => { resolve = done; }));
    const sink = createFirebaseAnalyticsSink(loader);
    for (const name of ['session_start', 'purchase_cancelled', 'session_end']) {
      sink.emit({ name, params: { product_id: 'hints_pack', surface: 'shop' }, timestamp: 1, sessionId: 's', env: 'development' });
    }
    expect(logEvent).not.toHaveBeenCalled();
    resolve({ FirebaseAnalytics: { logEvent } });
    await vi.waitFor(() => expect(logEvent).toHaveBeenCalledTimes(3));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls.map(([options]) => options.name)).toEqual(['game_session_start', 'purchase_cancelled', 'game_session_end']);
    expect(logEvent).toHaveBeenCalledWith({ name: 'purchase_cancelled', params: expect.objectContaining({ product_id: 'hints_pack', surface: 'shop', env: 'development' }) });
  });

  it('contains a native transport rejection without rejecting the game event', async () => {
    const logEvent = vi.fn(async () => { throw new Error('native transport failed'); });
    const sink = createFirebaseAnalyticsSink(async () => ({ FirebaseAnalytics: { logEvent } }));
    expect(() => sink.emit({ name: 'purchase_cancelled', params: {}, timestamp: 1, sessionId: 's', env: 'development' })).not.toThrow();
    await vi.waitFor(() => expect(logEvent).toHaveBeenCalledOnce());
  });
});
