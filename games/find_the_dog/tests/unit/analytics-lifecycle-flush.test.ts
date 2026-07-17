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

beforeEach(() => {
  resetGameLifecycleForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetGameLifecycleForTest();
});

describe('analytics lifecycle flush (session_end loss fix)', () => {
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
