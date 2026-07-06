/** Race a promise against a timeout. Resolves with the promise's value, or
 * rejects with a `TimeoutError` after `timeoutMs`. The timer is always cleared.
 *
 * Used to bound native-bridge calls (ads / attribution / analytics / IAP)
 * that can hang indefinitely if the native SDK or WebView drops a callback.
 * A hung call would otherwise wedge level progression, black out attribution
 * for every subsequent event, or permanently disable every Buy button.
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
 * NOTE (carry): originally from find_the_dog's `utils/withTimeout.ts`. This is
 * a cross-SDK primitive (ads / attribution / analytics / IAP all bound native
 * calls with it) consolidated here to a single copy for the whole sdk package.
 * It is an internal util, not public API — the subtree barrels deliberately do
 * NOT re-export it. Its eventual home is `@fabrikav2/kernel`; a later card
 * should promote it there. */
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
