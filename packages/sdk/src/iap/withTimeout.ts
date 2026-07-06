/**
 * Race a promise against a timeout. Resolves with the promise's value, or
 * rejects with a `TimeoutError` after `timeoutMs`. The timer is always cleared.
 *
 * Carried nearly verbatim from v1 `games/find_the_dog/src/utils/withTimeout.ts`
 * — the IAP service uses it to bound native-bridge calls (configure / getProducts
 * / purchase / restore) that can hang indefinitely if the native SDK or WebView
 * drops a callback. A hung call would otherwise wedge purchase/restore and
 * permanently disable every Buy button.
 *
 * Throws a named `TimeoutError` on timeout so callers can distinguish a transient
 * timeout from a real native rejection.
 */
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
