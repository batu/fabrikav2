import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analytics, AnalyticsService } from '../../src/analytics/AnalyticsService';
import { createAnalytics, type AnalyticsSink } from '@fabrikav2/sdk/analytics';
import { createAppsFlyerAnalyticsProjection } from '@fabrikav2/sdk/attribution';
import { resetGameLifecycleForTest, setLifecycleForTest } from '../../src/platform/gameLifecycle';

interface SdkSeam {
  sdk: {
    track: (...args: unknown[]) => void;
    sessionEnd: (...args: unknown[]) => void;
    sessionStart: (...args: unknown[]) => void;
    flush: () => Promise<void>;
  };
}

function sdk(): SdkSeam['sdk'] {
  return (analytics as unknown as SdkSeam).sdk;
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

const locks = {
  request: async (_name: string, callback: () => boolean | Promise<boolean>) => callback(),
};

beforeEach(() => {
  analytics.configureComposition({
    sdk: sdk() as never,
    storage: memoryStorage(),
    storageDurability: 'durable',
    firstOpenLocks: locks,
  });
  resetGameLifecycleForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetGameLifecycleForTest();
});

describe('analytics lifecycle flush (session_end loss fix)', () => {
  it('projects D1 from the real service foreground lifecycle chain', async () => {
    let now = 1_000;
    const forward = vi.fn(async () => true);
    const keys = new Set<string>();
    const storage = memoryStorage();
    const projection = createAppsFlyerAnalyticsProjection({
      forward, storage, now: () => now,
      dedupe: { has: (key) => keys.has(key), add: (key) => { keys.add(key); } },
    });
    const service = new AnalyticsService({
      sdk: createAnalytics({ env: 'production', sessionId: 'session', sinks: [projection] }),
      storage, storageDurability: 'durable', firstOpenLocks: locks,
    });
    await service.init();
    await service.appOpen();
    await setLifecycleForTest('inactive');
    now += 86_400_000;
    await setLifecycleForTest('active');
    await setLifecycleForTest('active');
    await Promise.resolve();
    expect(forward).toHaveBeenCalledExactlyOnceWith({ type: 'retention_milestone', day: 1 });
  });

  it('keeps the suspend transition pending until buffering sinks finish flushing', async () => {
    let releaseFlush = (): void => {};
    const sink: AnalyticsSink = {
      name: 'delayed-buffer',
      emit: vi.fn(),
      flush: () => new Promise<void>((resolve) => { releaseFlush = resolve; }),
    };
    const service = new AnalyticsService({
      sdk: createAnalytics({ env: 'test', sessionId: 'session', sinks: [sink] }),
      storage: memoryStorage(),
      storageDurability: 'durable',
      firstOpenLocks: locks,
    });
    await service.init();

    const suspending = setLifecycleForTest('inactive');
    const duplicateSuspend = setLifecycleForTest('inactive');
    let completed = false;
    let duplicateCompleted = false;
    void suspending.then(() => { completed = true; });
    void duplicateSuspend.then(() => { duplicateCompleted = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(duplicateCompleted).toBe(false);

    releaseFlush();
    await suspending;
    await duplicateSuspend;
    expect(completed).toBe(true);
    expect(duplicateCompleted).toBe(true);
  });

  it('emits one initial session when init is repeated sequentially or concurrently', async () => {
    const sessionStart = vi.spyOn(sdk(), 'sessionStart');

    const first = analytics.init();
    const concurrent = analytics.init();
    await Promise.all([first, concurrent]);
    await analytics.init();

    expect(sessionStart).toHaveBeenCalledTimes(1);
    expect(sessionStart).toHaveBeenCalledWith({ first_open: true });
  });

  it('migrates durable Find the Bird game state without classifying an upgrade as first_open', async () => {
    const sessionStart = vi.spyOn(sdk(), 'sessionStart');
    analytics.configureComposition({
      sdk: sdk() as never,
      storage: memoryStorage({ ftd_achievements: '{"version":1}' }),
      firstOpenLocks: locks,
    });

    await analytics.init();

    expect(sessionStart).toHaveBeenCalledWith({ first_open: false });
  });

  it('backgrounding tracks app_background, ends the session, and flushes sinks', async () => {
    const track = vi.spyOn(sdk(), 'track');
    const sessionEnd = vi.spyOn(sdk(), 'sessionEnd');
    const flush = vi.spyOn(sdk(), 'flush').mockResolvedValue();

    await analytics.init();
    setLifecycleForTest('inactive'); // simulated appStateChange/visibility hidden

    expect(track).toHaveBeenCalledWith('app_background');
    expect(sessionEnd).toHaveBeenCalled();
    expect(flush).toHaveBeenCalled();
  });

  it('orders first session, queued suspend flush, and app_open across the bootstrap chain', async () => {
    const events: string[] = [];
    let releaseClaim = (): void => {};
    const delayedLocks = {
      request: async (_name: string, callback: () => boolean | Promise<boolean>) => {
        await new Promise<void>((resolve) => { releaseClaim = resolve; });
        return callback();
      },
    };
    analytics.configureComposition({ sdk: sdk() as never, storage: memoryStorage(), firstOpenLocks: delayedLocks });
    vi.spyOn(sdk(), 'sessionStart').mockImplementation((params: unknown) => { events.push(`session_start:${JSON.stringify(params)}`); });
    vi.spyOn(sdk(), 'track').mockImplementation((name: unknown) => { events.push(String(name)); });
    vi.spyOn(sdk(), 'sessionEnd').mockImplementation(() => { events.push('session_end'); });
    vi.spyOn(sdk(), 'flush').mockImplementation(async () => { events.push('flush'); });

    const initializing = analytics.init({ hadExistingStateAtBootstrap: false });
    const suspending = setLifecycleForTest('inactive');
    let suspendCompleted = false;
    void suspending.then(() => { suspendCompleted = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([]);
    expect(suspendCompleted).toBe(false);
    releaseClaim();
    await initializing;
    await suspending;
    await analytics.appOpen();

    expect(events).toEqual([
      'session_start:{"first_open":true}',
      'app_background',
      'session_end',
      'flush',
      'app_open',
    ]);
    expect(suspendCompleted).toBe(true);
  });

  it('reconciles suspend then resume during first-open claim without a resumed or background session', async () => {
    const events: string[] = [];
    let releaseClaim = (): void => {};
    const delayedLocks = {
      request: async (_name: string, callback: () => boolean | Promise<boolean>) => {
        await new Promise<void>((resolve) => { releaseClaim = resolve; });
        return callback();
      },
    };
    analytics.configureComposition({ sdk: sdk() as never, storage: memoryStorage(), firstOpenLocks: delayedLocks });
    vi.spyOn(sdk(), 'sessionStart').mockImplementation((params: unknown) => { events.push(`session_start:${JSON.stringify(params)}`); });
    vi.spyOn(sdk(), 'track').mockImplementation((name: unknown) => { events.push(String(name)); });
    vi.spyOn(sdk(), 'sessionEnd').mockImplementation(() => { events.push('session_end'); });
    vi.spyOn(sdk(), 'flush').mockImplementation(async () => { events.push('flush'); });

    const initializing = analytics.init({ hadExistingStateAtBootstrap: false });
    setLifecycleForTest('inactive');
    setLifecycleForTest('active');
    expect(events).toEqual([]);
    releaseClaim();
    await initializing;

    expect(events).toEqual(['session_start:{"first_open":true}']);
  });

  it('orders session_start(first_open), app_open, then lifecycle flush on a normal boot', async () => {
    const events: string[] = [];
    vi.spyOn(sdk(), 'sessionStart').mockImplementation((params: unknown) => { events.push(`session_start:${JSON.stringify(params)}`); });
    vi.spyOn(sdk(), 'track').mockImplementation((name: unknown) => { events.push(String(name)); });
    vi.spyOn(sdk(), 'flush').mockImplementation(async () => { events.push('flush'); });

    await analytics.init({ hadExistingStateAtBootstrap: false });
    await analytics.appOpen();
    setLifecycleForTest('inactive');

    expect(events).toEqual([
      'session_start:{"first_open":true}',
      'app_open',
      'app_background',
      'flush',
    ]);
  });

  it('foregrounding tracks app_foreground and starts a new session segment', async () => {
    const track = vi.spyOn(sdk(), 'track');
    const sessionStart = vi.spyOn(sdk(), 'sessionStart');

    await analytics.init();
    setLifecycleForTest('inactive');
    sessionStart.mockClear();
    setLifecycleForTest('active');

    expect(track).toHaveBeenCalledWith('app_foreground');
    expect(sessionStart).toHaveBeenCalledTimes(1);
    setLifecycleForTest('active');
    expect(sessionStart).toHaveBeenCalledTimes(1);
  });
});
