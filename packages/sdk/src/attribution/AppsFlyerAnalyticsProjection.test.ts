import { describe, expect, it, vi } from 'vitest';
import { createAppsFlyerAnalyticsProjection } from './AppsFlyerAnalyticsProjection.ts';

function event(name: string, params: Record<string, unknown> = {}) { return { name, params, env: 'production', sessionId: 's', timestamp: 1 } as never; }
function memory() { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }; }

describe('AppsFlyer analytics projection', () => {
  it('reports delivered and rejected projections after emission', async () => {
    const forward = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const sink = createAppsFlyerAnalyticsProjection({
      forward,
      dedupe: { has: () => false, add: vi.fn() },
      storage: memory(),
    });

    sink.emit(event('level_complete', { sequence_slot: 1 }));
    expect(sink.diagnostics?.()).toMatchObject({ queued: 2, sent: 0, dropped: 0 });
    await Promise.all([Promise.resolve(), Promise.resolve(), Promise.resolve()]);

    expect(sink.diagnostics?.()).toEqual({
      queued: 0,
      sent: 1,
      retried: 0,
      dropped: 1,
      initializationFailure: null,
      lastSuccessfulFlushAt: null,
    });
  });

  it('projects tutorial and selected progression milestones once', async () => {
    const forward = vi.fn(async (_event: unknown) => true); const keys = new Set<string>();
    const sink = createAppsFlyerAnalyticsProjection({ forward, dedupe: { has: (k) => keys.has(k), add: (k) => { keys.add(k); } }, storage: memory() });
    sink.emit(event('level_complete', { sequence_slot: 1, level_id: 'hashed-scene-a1' })); sink.emit(event('level_complete', { sequence_slot: 1, level_id: 'hashed-scene-a1' }));
    sink.emit(event('level_complete', { sequence_slot: 2, level_id: 'hashed-scene-b2' })); sink.emit(event('level_complete', { sequence_slot: 5, level_id: 'hashed-scene-c3' }));
    await Promise.resolve();
    expect(forward.mock.calls.map(([value]) => value)).toEqual([
      { type: 'tutorial_completed', tutorialId: 'intro' },
      { type: 'progression_milestone', level: 1 },
      { type: 'progression_milestone', level: 5 },
    ]);
  });
  it('emits D1 only after a genuine next-day return and never duplicates it', async () => {
    const forward = vi.fn(async (_event: unknown) => true); const storage = memory(); const keys = new Set<string>(); let now = 1_000;
    const sink = createAppsFlyerAnalyticsProjection({ forward, dedupe: { has: (k) => keys.has(k), add: (k) => { keys.add(k); } }, storage, now: () => now });

    sink.emit(event('app_open')); await Promise.resolve();
    now += 86_400_000 - 1; sink.emit(event('app_open')); await Promise.resolve();
    expect(forward).not.toHaveBeenCalled();

    now += 1; sink.emit(event('app_open')); sink.emit(event('app_open')); await Promise.resolve();
    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith({ type: 'retention_milestone', day: 1 });
  });

  it('counts a next-day foreground return without requiring a cold launch', async () => {
    const forward = vi.fn(async (_event: unknown) => true);
    const keys = new Set<string>();
    let now = 1_000;
    const sink = createAppsFlyerAnalyticsProjection({ forward, dedupe: { has: (k) => keys.has(k), add: (k) => { keys.add(k); } }, storage: memory(), now: () => now });
    sink.emit(event('app_open'));
    now += 86_400_000;
    sink.emit(event('app_foreground'));
    sink.emit(event('app_foreground'));
    await Promise.resolve();
    expect(forward).toHaveBeenCalledExactlyOnceWith({ type: 'retention_milestone', day: 1 });
  });

  it('does not forward development traffic or seed its retention clock', async () => {
    const forward = vi.fn(async (_event: unknown) => true);
    const storage = memory();
    const sink = createAppsFlyerAnalyticsProjection({ forward, dedupe: { has: () => false, add: vi.fn() }, storage, now: () => 1_000 });
    sink.emit({ name: 'level_complete', params: { sequence_slot: 1 }, sessionId: 's', timestamp: 1, env: 'development' } as never);
    sink.emit({ name: 'app_open', params: {}, sessionId: 's', timestamp: 1, env: 'development' } as never);
    await Promise.resolve();
    expect(forward).not.toHaveBeenCalled();
    expect(storage.getItem('appsflyer-first-seen-at')).toBeNull();
  });

  it('uses exact elapsed-day boundaries for later retention milestones', async () => {
    const forward = vi.fn(async (_event: unknown) => true); const storage = memory(); const keys = new Set<string>(); let now = 1_000;
    const sink = createAppsFlyerAnalyticsProjection({ forward, dedupe: { has: (k) => keys.has(k), add: (k) => { keys.add(k); } }, storage, now: () => now });

    sink.emit(event('app_open')); await Promise.resolve();
    now += 3 * 86_400_000 - 1; sink.emit(event('app_open')); await Promise.resolve();
    expect(forward).not.toHaveBeenCalled();
    now += 1; sink.emit(event('app_open')); await Promise.resolve();
    expect(forward).toHaveBeenCalledWith({ type: 'retention_milestone', day: 3 });
  });
});
