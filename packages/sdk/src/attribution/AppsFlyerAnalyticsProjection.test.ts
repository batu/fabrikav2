import { describe, expect, it, vi } from 'vitest';
import { createAppsFlyerAnalyticsProjection } from './AppsFlyerAnalyticsProjection.ts';

function event(name: string, params: Record<string, unknown> = {}) { return { name, params, env: 'production', sessionId: 's', timestamp: 1 } as never; }
function memory() { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }; }

describe('AppsFlyer analytics projection', () => {
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
