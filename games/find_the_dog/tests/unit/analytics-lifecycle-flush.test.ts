import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analytics } from '../../src/analytics/AnalyticsService';
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
  it('marks first_open exactly once for the install profile', async () => {
    const sessionStart = vi.spyOn(sdk(), 'sessionStart');

    await analytics.init();
    await analytics.init();

    expect(sessionStart).toHaveBeenNthCalledWith(1, { first_open: true });
    expect(sessionStart).toHaveBeenNthCalledWith(2, { first_open: false });
  });

  it('migrates durable Find the Dog game state without classifying an upgrade as first_open', async () => {
    const sessionStart = vi.spyOn(sdk(), 'sessionStart');
    analytics.configureComposition({
      sdk: sdk() as never,
      storage: memoryStorage({ ftd_total_levels_completed: '1' }),
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
    setLifecycleForTest('inactive');
    expect(events).toEqual([]);
    releaseClaim();
    await initializing;
    await analytics.appOpen();

    expect(events).toEqual([
      'session_start:{"first_open":true}',
      'app_background',
      'session_end',
      'flush',
      'app_open',
    ]);
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
    expect(sessionStart).toHaveBeenCalled();
  });
});
