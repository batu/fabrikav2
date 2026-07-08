export const DEFAULT_TOUR_DRIVE_TIMEOUT_MS = 20_000;

type TimerHandle = number | ReturnType<typeof globalThis.setTimeout>;

export interface TourDriveTimeoutOptions<State extends string = string> {
  timeoutMs?: number;
  onTimeout?: (state: State) => void;
  setTimeoutFn?: (handler: () => void, timeoutMs: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
}

export async function driveTourStateWithTimeout<State extends string>(
  state: State,
  driveTo: (state: State) => Promise<boolean>,
  options: TourDriveTimeoutOptions<State> = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TOUR_DRIVE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return driveTo(state);
  }

  const setTimeoutFn = options.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? ((handle: TimerHandle): void => globalThis.clearTimeout(handle));
  let timeoutHandle: TimerHandle | null = null;
  let timedOut = false;

  const timeout = new Promise<false>((resolve) => {
    timeoutHandle = setTimeoutFn(() => {
      timedOut = true;
      options.onTimeout?.(state);
      resolve(false);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => driveTo(state)),
      timeout,
    ]);
  } finally {
    if (!timedOut && timeoutHandle !== null) {
      clearTimeoutFn(timeoutHandle);
    }
  }
}
