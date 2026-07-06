/** Race a promise against a timeout. Resolves with the promise's value, or
 * rejects with a TimeoutError after `timeoutMs`. The timer is always cleared.
 *
 * Used to bound native-bridge calls (ads / attribution / analytics / IAP)
 * that can hang indefinitely if the native SDK or WebView drops a callback.
 * A hung call would otherwise wedge level progression, mute audio for the
 * rest of the session, or black out attribution for every subsequent event.
 *
 * Sibling native layers partially bound some calls (e.g. Android AppLovin:
 * init 30s, load 15s, full-screen show 5min) but iOS native has none, and
 * the Android show timeout is 5min — so the TS layer provides faster,
 * platform-uniform recovery.
 *
 * Throws a `TimeoutError` (a named subclass) on timeout so callers can
 * distinguish a transient timeout from a real native rejection — e.g. an ad
 * provider should not permanently disable itself on a cold-start timeout,
 * but may on a definitive plugin error.
 *
 * VENDORED into the attribution subtree: v1 core imported this from
 * `../runtime/with-timeout`, which does not yet exist in v2. This card's
 * file boundary confines edits to `packages/sdk/**`, so it lives here for
 * now; a later card should promote it to `@fabrikav2/kernel` and de-dupe. */
export class TimeoutError extends Error {
  constructor(public readonly label: string, public readonly timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

export function isTimeoutError(err: unknown): err is TimeoutError {
  return err instanceof TimeoutError;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject): void => {
    timeoutId = setTimeout((): void => reject(new TimeoutError(label, timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally((): void => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}
