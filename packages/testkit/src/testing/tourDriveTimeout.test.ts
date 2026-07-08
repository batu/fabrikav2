import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_TOUR_DRIVE_TIMEOUT_MS, driveTourStateWithTimeout } from './tourDriveTimeout.ts';

describe('driveTourStateWithTimeout', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('returns the settled driveTo result before the watchdog expires', async (): Promise<void> => {
    vi.useFakeTimers();

    const result = await driveTourStateWithTimeout(
      'menu',
      async () => true,
      { timeoutMs: DEFAULT_TOUR_DRIVE_TIMEOUT_MS },
    );

    expect(result).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns false when driveTo never settles', async (): Promise<void> => {
    vi.useFakeTimers();
    const timedOutStates: string[] = [];

    const run = driveTourStateWithTimeout(
      'settings',
      async () => new Promise<boolean>(() => {}),
      {
        timeoutMs: DEFAULT_TOUR_DRIVE_TIMEOUT_MS,
        onTimeout: (state) => timedOutStates.push(state),
      },
    );

    await vi.advanceTimersByTimeAsync(DEFAULT_TOUR_DRIVE_TIMEOUT_MS);

    await expect(run).resolves.toBe(false);
    expect(timedOutStates).toEqual(['settings']);
  });
});
