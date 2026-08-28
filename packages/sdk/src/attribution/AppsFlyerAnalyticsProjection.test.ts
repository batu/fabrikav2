import { describe, expect, it, vi } from 'vitest';
import { createAppsFlyerAnalyticsProjection } from './AppsFlyerAnalyticsProjection.ts';

function event(name: string, params: Record<string, unknown> = {}) { return { name, params, env: 'production', sessionId: 's', timestamp: 1 } as never; }
function memory() { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }; }

describe('AppsFlyer analytics projection', () => {
  it('projects tutorial and selected progression milestones once', async () => {
    const forward = vi.fn(async (_event: unknown) => true); const keys = new Set<string>();
    const sink = createAppsFlyerAnalyticsProjection({ forward, dedupe: { has: (k) => keys.has(k), add: (k) => { keys.add(k); } }, storage: memory() });
    sink.emit(event('level_complete', { level_id: 'level-1' })); sink.emit(event('level_complete', { level_id: 'level-1' }));
    sink.emit(event('level_complete', { level_id: 'level-2' })); sink.emit(event('level_complete', { level_id: 'level-5' }));
    await Promise.resolve();
    expect(forward.mock.calls.map(([value]) => value)).toEqual([
      { type: 'tutorial_completed', tutorialId: 'intro' },
      { type: 'progression_milestone', level: 1 },
      { type: 'progression_milestone', level: 5 },
    ]);
  });
  it('projects bounded retention days from first seen time', async () => {
    const forward = vi.fn(async (_event: unknown) => true); const storage = memory(); const keys = new Set<string>(); let now = 1_000;
    const sink = createAppsFlyerAnalyticsProjection({ forward, dedupe: { has: (k) => keys.has(k), add: (k) => { keys.add(k); } }, storage, now: () => now });
    sink.emit(event('app_open')); await Promise.resolve(); now += 2 * 86_400_000; sink.emit(event('app_open')); await Promise.resolve();
    expect(forward).toHaveBeenNthCalledWith(1, { type: 'retention_milestone', day: 1 });
    expect(forward).toHaveBeenNthCalledWith(2, { type: 'retention_milestone', day: 3 });
  });
});
